"""Compare persisted tracklets and optional query rank-5 against the analysis bundle."""
import argparse
import json
from pathlib import Path
import numpy as np
from tracklet_pipeline import load_bundle
from model_db import connect

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('folder',type=Path)
p.add_argument('--video-id',type=int,required=True)
p.add_argument('--query-output',type=Path)
a=p.parse_args()
m,v=load_bundle(a.folder)
with connect() as c:
    rows=c.execute('''SELECT t.track_no,e.embedding,t.thumbnail_samples FROM tracklets t
        JOIN tracklet_embeddings e ON e.tracklet_id=t.id
        WHERE t.video_id=%s AND e.model_name=%s ORDER BY t.track_no''',(a.video_id,m['model_name'])).fetchall()
    assert len(rows)==len(v)
    for row,t,vec in zip(rows,m['tracks'],v):
        actual=row[1].to_numpy() if hasattr(row[1],'to_numpy') else row[1]
        assert row[0]==t['track_no'] and np.allclose(actual,vec,atol=1e-6)
        assert row[2]==t['samples']
    print(f'PASS: {len(rows)} ID vectors and {sum(len(r[2]) for r in rows)} thumbnails match DB')
if a.query_output:
    q=np.load(a.query_output/'query_vector.npy')
    results=json.loads((a.query_output/'results.json').read_text(encoding='utf-8'))
    order=np.argsort(-(v@q))[:5]
    assert [m['tracks'][i]['track_no'] for i in order]==[r['track_no'] for r in results]
    assert np.allclose(v[order]@q,[r['similarity'] for r in results],atol=1e-5)
    print('PASS: pgvector rank-5 matches independent NumPy cosine ranking')
