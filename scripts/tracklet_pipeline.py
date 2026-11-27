"""Full-frame tracking -> one crop per ID/second -> DB tracklets -> photo rank-5 report."""
import argparse
import base64
from datetime import datetime, timedelta
import hashlib
import html
import json
import math
import os
from pathlib import Path
import sys
from uuid import uuid4

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault('YOLO_CONFIG_DIR', str(ROOT / '.runtime/ultralytics'))
os.environ.setdefault('MPLCONFIGDIR', str(ROOT / '.runtime/matplotlib'))
sys.path.insert(0,str(ROOT / '모델벤치'))
from search_benchmark import IntelEncoder, normalize, read_image, save_image, resolve_device
from model_db import connect


def select_quality(crop, confidence, cv2):
    sharpness=float(cv2.Laplacian(cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var())
    return float(confidence)*math.sqrt(crop.shape[0]*crop.shape[1])*math.log1p(sharpness)


def analyze(args):
    import cv2
    import torch
    from ultralytics import YOLO
    if not args.video.is_file():
        raise ValueError(f'Video not found: {args.video}')
    start=datetime.fromisoformat(args.recorded_start)
    if start.tzinfo is None:
        raise ValueError('--recorded-start must include timezone, e.g. +09:00')
    cap=cv2.VideoCapture(str(args.video.resolve()))
    if not cap.isOpened():
        raise ValueError('Cannot open video')
    fps=float(cap.get(cv2.CAP_PROP_FPS))
    if not math.isfinite(fps) or fps<=0:
        cap.release(); raise ValueError('Invalid FPS')
    expected=round(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    output=(args.output_root / ('tracklets_'+uuid4().hex[:12])).resolve()
    output.mkdir(parents=True)
    device=resolve_device(args.device,torch)
    model=YOLO(str(ROOT/'모델벤치/yolo26n.pt'))
    encoder=IntelEncoder(cv2,np)
    tracker=output/'bytetrack.yaml'
    tracker.write_text(json.dumps(dict(tracker_type='bytetrack',track_high_thresh=.25,
        track_low_thresh=.1,new_track_thresh=.25,track_buffer=90,match_thresh=.8,fuse_score=True)),encoding='utf-8')
    tracks={}; samples=[]; sample_vectors=[]; count=0; bucket=None

    def flush():
        for track_no,t in tracks.items():
            c=t.pop('candidate',None)
            if c is None: continue
            folder=output/'thumbnails'/f'id_{track_no:05d}'
            folder.mkdir(parents=True,exist_ok=True)
            path=folder/f'second_{c["second"]:05d}.jpg'
            save_image(path,c['crop'],cv2)
            # Encode the saved JPEG itself, so vectors correspond to the delivered thumbnails.
            vector=encoder.embed(read_image(path,cv2,np))
            item=dict(track_no=track_no,second=c['second'],video_seconds=c['time'],
                frame_1based=c['frame'],box=c['box'],confidence=c['confidence'],
                quality=c['quality'],path=str(path))
            t['samples'].append(item); samples.append(item); sample_vectors.append(vector)
            if c['quality']>t.get('best_quality',-1):
                t['best_quality']=c['quality']; t['thumbnail_path']=str(path)

    tracking_video = getattr(args, 'tracking_video', None)
    writer = None
    partial = None
    try:
        if tracking_video is not None:
            if tracking_video.suffix.lower() != '.mp4' or tracking_video.exists():
                raise ValueError('Tracking output must be a new MP4 file')
            partial = tracking_video.with_name(f'.{uuid4().hex}.partial.mp4')
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            writer = cv2.VideoWriter(str(partial), cv2.VideoWriter_fourcc(*'mp4v'),
                                     fps, (width, height))
            if not writer.isOpened():
                raise ValueError(f'Cannot open tracking output: {tracking_video}')
        while True:
            ok,frame=cap.read()
            if not ok: break
            seconds=count/fps; second=int(math.floor(seconds))
            if bucket is not None and second!=bucket: flush()
            bucket=second
            result=model.track(frame,persist=True,tracker=str(tracker),classes=[0],
                conf=.1,iou=.7,imgsz=args.imgsz,device=device,verbose=False)[0]
            boxes=result.boxes
            if boxes is not None and boxes.id is not None:
                h,w=frame.shape[:2]
                for no,xyxy,confidence in zip(boxes.id.cpu().numpy(),boxes.xyxy.cpu().numpy(),boxes.conf.cpu().numpy()):
                    no=int(no)
                    x1,y1,x2,y2=map(int,xyxy)
                    x1,x2=max(0,x1),min(w,x2); y1,y2=max(0,y1),min(h,y2)
                    if x2<=x1 or y2<=y1: continue
                    t=tracks.setdefault(no,dict(track_no=no,start_seconds=seconds,end_seconds=seconds,trajectory=[],samples=[]))
                    t['end_seconds']=seconds
                    t['trajectory'].append([seconds,(x1+x2)/2,(y1+y2)/2])
                    crop=frame[y1:y2,x1:x2]
                    quality=select_quality(crop,confidence,cv2)
                    if quality>t.get('candidate',{}).get('quality',-1):
                        t['candidate']=dict(crop=crop.copy(),quality=quality,second=second,
                            time=seconds,frame=count+1,box=[x1,y1,x2,y2],confidence=float(confidence))
            if writer is not None:
                writer.write(result.plot(labels=True, conf=False) if boxes is not None and boxes.id is not None else frame)
            count+=1
            if count==1 or count%max(1,round(fps*5))==0:
                print(f'Tracking {count}/{expected} frames; IDs={len(tracks)}; thumbnails={len(samples)}',flush=True)
        flush()
        if count==0 or (expected>0 and count!=expected):
            raise ValueError(f'Incomplete decode: {count}/{expected}')
        if not tracks: raise ValueError('No tracked people found')
        numbers=sorted(tracks)
        vectors=[]
        for no in numbers:
            chosen=[sample_vectors[i] for i,s in enumerate(samples) if s['track_no']==no]
            vectors.append(normalize(np.mean(chosen,axis=0),256,np))
        np.savez_compressed(output/'embeddings.npz',track_numbers=np.array(numbers),
            track_vectors=np.array(vectors,dtype=np.float32),
            sample_vectors=np.array(sample_vectors,dtype=np.float32),
            sample_track_numbers=np.array([s['track_no'] for s in samples]),
            sample_seconds=np.array([s['second'] for s in samples]))
        manifest=dict(analysis_key=output.name,source_video=str(args.video.resolve()),
            source_sha256=hashlib.sha256(args.video.read_bytes()).hexdigest(),
            recorded_start_at=start.isoformat(),fps=fps,duration_s=count/fps,
            decoded_frames=count,model_name=encoder.model_id,detector='yolo26n',
            imgsz=args.imgsz,sampling='best quality per ID per video-second; saved JPEG encoded',
            aggregation='mean of L2-normalized sample vectors, then L2 normalization',
            demo_metadata=args.demo,tracks=[tracks[no] for no in numbers])
        (output/'tracks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        if writer is not None:
            writer.release()
            writer = None
            probe = cv2.VideoCapture(str(partial))
            try:
                readable, _ = probe.read()
                if not readable or round(probe.get(cv2.CAP_PROP_FRAME_COUNT)) != count:
                    raise ValueError('Tracking MP4 frame count does not match analysis')
            finally:
                probe.release()
            partial.rename(tracking_video)
        print(f'Analysis complete: {output}; tracks={len(numbers)}, thumbnails={len(samples)}')
        return output
    except BaseException:
        (output/'FAILED.txt').write_text('Analysis incomplete; do not ingest',encoding='utf-8')
        raise
    finally:
        cap.release()
        if writer is not None:
            writer.release()
        if partial is not None:
            partial.unlink(missing_ok=True)


def load_bundle(folder):
    folder=Path(folder).resolve()
    if (folder/'FAILED.txt').exists(): raise ValueError('Incomplete analysis')
    m=json.loads((folder/'tracks.json').read_text(encoding='utf-8'))
    with np.load(folder/'embeddings.npz',allow_pickle=False) as data:
        numbers=data['track_numbers'].copy(); vectors=data['track_vectors'].copy()
        sample_vectors=data['sample_vectors'].copy()
        sample_ids=data['sample_track_numbers'].copy()
        sample_seconds=data['sample_seconds'].copy()
    if vectors.shape!=(len(numbers),256) or not np.isfinite(vectors).all():
        raise ValueError('Invalid track vectors')
    if not np.allclose(np.linalg.norm(vectors,axis=1),1,atol=1e-4):
        raise ValueError('Track vectors must be normalized')
    if not m['tracks']: raise ValueError('No tracklets in bundle')
    if list(numbers)!=[t['track_no'] for t in m['tracks']] or len(set(numbers))!=len(numbers):
        raise ValueError('Track IDs and vectors do not match')
    start=datetime.fromisoformat(m['recorded_start_at'])
    if start.tzinfo is None: raise ValueError('Timestamp timezone is required')
    for t in m['tracks']:
        if t['end_seconds']<t['start_seconds'] or not t['samples']:
            raise ValueError('Invalid track timing or missing samples')
        buckets=[s['second'] for s in t['samples']]
        if len(set(buckets))!=len(buckets): raise ValueError('Duplicate ID/second thumbnail')
        for s in t['samples']:
            if not Path(s['path']).is_file(): raise ValueError('Missing thumbnail')
    keys=[(int(no),int(sec)) for no,sec in zip(sample_ids,sample_seconds)]
    expected_keys={(t['track_no'],s['second']) for t in m['tracks'] for s in t['samples']}
    if len(keys)!=len(set(keys)) or set(keys)!=expected_keys:
        raise ValueError('Sample vectors do not match thumbnail metadata')
    if sample_vectors.shape!=(len(keys),256) or not np.isfinite(sample_vectors).all():
        raise ValueError('Invalid sample vectors')
    if not np.allclose(np.linalg.norm(sample_vectors,axis=1),1,atol=1e-4):
        raise ValueError('Sample vectors must be normalized')
    for no,vector in zip(numbers,vectors):
        mean=normalize(sample_vectors[sample_ids==no].mean(axis=0),256,np)
        if not np.allclose(vector,mean,atol=1e-5):
            raise ValueError('Track vector differs from thumbnail mean')
    return m,vectors


def ingest(args):
    from psycopg.types.json import Jsonb
    m,vectors=load_bundle(args.folder)
    start=datetime.fromisoformat(m['recorded_start_at'])
    with connect() as conn:
        old=conn.execute('SELECT id,status FROM videos WHERE analysis_key=%s',(m['analysis_key'],)).fetchone()
        if old:
            if old[1]!='done': raise ValueError('Existing video is not complete')
            print(f'Already stored: video_id={old[0]}'); return old[0]
        camera=args.camera_id
        if camera is None and not getattr(args, 'unmapped_camera', False):
            if not m['demo_metadata']: raise ValueError('--camera-id is required for real data')
            camera=conn.execute("""INSERT INTO nodes(kind,name,location)
                VALUES ('camera','DEMO video_1 — synthetic location',ST_GeogFromText('POINT(127 37)')) RETURNING id""").fetchone()[0]
            conn.execute('INSERT INTO cameras(node_id,heading_deg,fov_deg) VALUES (%s,0,90)',(camera,))
        metadata={k:v for k,v in m.items() if k!='tracks'}
        video=conn.execute('''INSERT INTO videos(camera_id,file_path,recorded_start_at,duration_s,fps,
            status,progress,analysis_key,analysis_metadata) VALUES (%s,%s,%s,%s,%s,'running',0,%s,%s) RETURNING id''',
            (camera,m['source_video'],start,m['duration_s'],m['fps'],m['analysis_key'],Jsonb(metadata))).fetchone()[0]
        for t,vector in zip(m['tracks'],vectors):
            track=conn.execute('''INSERT INTO tracklets(video_id,camera_id,track_no,start_at,end_at,
                trajectory,thumbnail_path,thumbnail_samples) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
                (video,camera,t['track_no'],start+timedelta(seconds=t['start_seconds']),
                 start+timedelta(seconds=t['end_seconds']),Jsonb(t['trajectory']),t['thumbnail_path'],Jsonb(t['samples']))).fetchone()[0]
            conn.execute('INSERT INTO tracklet_embeddings(tracklet_id,model_name,embedding) VALUES (%s,%s,%s)',
                (track,m['model_name'],vector))
        conn.execute("UPDATE videos SET status='done',progress=100 WHERE id=%s",(video,))
    print(f'DB saved: video_id={video}, tracks={len(vectors)}')
    return video


def image_data(path):
    return 'data:image/jpeg;base64,'+base64.b64encode(Path(path).read_bytes()).decode()


def render_report(path,query_path,rows,video_id):
    cards=[]
    for rank,r in enumerate(rows,1):
        cards.append(f'''<article><h2>Rank {rank} · ID {r['track_no']}</h2>
        <img src="{image_data(r['thumbnail_path'])}" alt="candidate {rank}">
        <p>코사인 유사도 <strong>{r['similarity']:.4f}</strong></p>
        <p>{r['start_seconds']:.2f}–{r['end_seconds']:.2f}초 · 썸네일 {r['sample_count']}장</p>
        <p>DB 트랙렛 {r['tracklet_id']}</p></article>''')
    path.write_text('''<!doctype html><html lang="ko"><meta charset="utf-8"><title>인물 검색 Rank 5</title>
    <style>body{font-family:system-ui;background:#101827;color:#eef2ff;margin:32px}header{display:flex;gap:24px;align-items:center}img{max-width:100%;height:260px;object-fit:contain;background:#080e1b;border-radius:10px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}article{background:#1e293b;padding:18px;border-radius:16px}p{color:#cbd5e1}strong{color:#5eead4}</style>
    <header><img alt="query" src="'''+image_data(query_path)+f'''"><div><h1>인물 검색 · Rank 5</h1>
    <p>DB video_id {video_id} · YOLO26n + Intel Re-ID · ID별 평균 벡터</p>
    <p>표시는 추적 ID 기준입니다. 같은 사람이 ID 단절로 여러 후보에 나타날 수 있습니다.</p>
    <p>점수는 동일인 확률이 아닙니다. 후보 {len(rows)}개.</p></div></header><section>'''+''.join(cards)+ '</section></html>',encoding='utf-8')


def render_contact_sheet(path,query_path,rows):
    from PIL import Image,ImageDraw
    canvas=Image.new('RGB',(1500,490),'#101827'); draw=ImageDraw.Draw(canvas)
    items=[('QUERY',str(query_path),'input photo')]+[
        (f'RANK {i} | ID {r["track_no"]}',r['thumbnail_path'],
         f'cosine {r["similarity"]:.4f} | {r["start_seconds"]:.2f}-{r["end_seconds"]:.2f}s')
        for i,r in enumerate(rows,1)]
    for i,(title,image_path,label) in enumerate(items):
        x=15+i*248
        draw.rounded_rectangle((x,45,x+234,475),radius=12,fill='#1e293b')
        draw.text((x+12,60),title,fill='#5eead4',font_size=17)
        im=Image.open(image_path).convert('RGB')
        scale=min(210/im.width,315/im.height)
        im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
        canvas.paste(im,(x+12+(210-im.width)//2,95+(315-im.height)//2))
        draw.text((x+10,432),label,fill='white',font_size=12)
    draw.text((22,15),'DB TRACKLET SEARCH | YOLO26n + Intel Re-ID | Top 5 track IDs',fill='white',font_size=19)
    canvas.save(path)


def query(args):
    import cv2
    image=read_image(args.image,cv2,np)
    if args.detect_person:
        from ultralytics import YOLO
        boxes=YOLO(str(ROOT/'모델벤치/yolo26n.pt')).predict(image,classes=[0],verbose=False)[0].boxes
        if boxes is None or len(boxes)==0: raise ValueError('No person detected; supply a cropped person image')
        coords=boxes.xyxy.cpu().numpy()
        coords=sorted(coords,key=lambda b:float((b[2]-b[0])*(b[3]-b[1])),reverse=True)
        if len(coords)>1 and args.person_index is None:
            raise ValueError(f'{len(coords)} people detected. Use --person-index 0..{len(coords)-1} (largest first)')
        index=0 if args.person_index is None else args.person_index
        if not 0<=index<len(coords): raise ValueError('Invalid person index')
        x1,y1,x2,y2=map(int,coords[index]); h,w=image.shape[:2]
        image=image[max(0,y1):min(h,y2),max(0,x1):min(w,x2)]
    encoder=IntelEncoder(cv2,np)
    output=(args.output_root/('query_'+uuid4().hex[:12])).resolve(); output.mkdir(parents=True)
    crop=output/'query.jpg'; save_image(crop,image,cv2)
    vector=encoder.embed(read_image(crop,cv2,np)); np.save(output/'query_vector.npy',vector)
    with connect() as conn:
        rows=conn.execute('''SELECT t.id,t.track_no,t.thumbnail_path,
            EXTRACT(EPOCH FROM(t.start_at-v.recorded_start_at))::float8,
            EXTRACT(EPOCH FROM(t.end_at-v.recorded_start_at))::float8,
            jsonb_array_length(t.thumbnail_samples),1-(e.embedding <=> %s) AS similarity
            FROM tracklets t JOIN videos v ON v.id=t.video_id
            JOIN tracklet_embeddings e ON e.tracklet_id=t.id
            WHERE v.id=%s AND v.status='done' AND e.model_name=%s
            ORDER BY e.embedding <=> %s,t.id LIMIT 5''',
            (vector,args.video_id,encoder.model_id,vector)).fetchall()
    if not rows: raise ValueError('No completed tracklets for that video and Re-ID model')
    results=[dict(zip(('tracklet_id','track_no','thumbnail_path','start_seconds','end_seconds','sample_count','similarity'),r)) for r in rows]
    (output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    render_report(output/'rank5.html',crop,results,args.video_id)
    render_contact_sheet(output/'rank5.png',crop,results)
    print(f'Rank-5 report: {output/"rank5.html"}')
    for rank,r in enumerate(results,1): print(f'Rank {rank}: ID {r["track_no"]}, cosine={r["similarity"]:.4f}')
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    a=sub.add_parser('analyze'); a.add_argument('--video',type=Path,default=ROOT/'모델벤치/video_1.mp4')
    a.add_argument('--recorded-start',required=True); a.add_argument('--demo',action='store_true')
    a.add_argument('--device',default='auto'); a.add_argument('--imgsz',type=int,default=1280)
    a.add_argument('--output-root',type=Path,default=ROOT/'runs/tracklets')
    a.add_argument('--tracking-video', type=Path, help='Save an MP4 with boxes and IDs from this analysis')
    i=sub.add_parser('ingest'); i.add_argument('folder',type=Path)
    camera = i.add_mutually_exclusive_group()
    camera.add_argument('--camera-id',type=int)
    camera.add_argument('--unmapped-camera', action='store_true',
                        help='Store without a camera ID in a database that supports unmapped videos')
    q=sub.add_parser('query'); q.add_argument('--image',type=Path,required=True)
    q.add_argument('--video-id',type=int,required=True); q.add_argument('--detect-person',action='store_true')
    q.add_argument('--person-index',type=int); q.add_argument('--output-root',type=Path,default=ROOT/'runs/search')
    args=parser.parse_args()
    {'analyze':analyze,'ingest':ingest,'query':query}[args.command](args)

if __name__=='__main__': main()
