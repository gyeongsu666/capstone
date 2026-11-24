import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from tracklet_pipeline import load_bundle

class TrackletBundleValidation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.folder=Path(self.tmp.name)
        thumb=self.folder/'thumb.jpg'; thumb.write_bytes(b'test')
        self.manifest=dict(recorded_start_at='2026-11-16T09:00:00+09:00',tracks=[
            dict(track_no=17,start_seconds=0,end_seconds=1.2,samples=[
                dict(second=0,path=str(thumb)),dict(second=1,path=str(thumb))])])
        self.samples=np.zeros((2,256),dtype=np.float32)
        self.samples[0,0]=1;self.samples[1,1]=1
        self.mean=self.samples.mean(axis=0); self.mean/=np.linalg.norm(self.mean)
        self.write()
    def tearDown(self): self.tmp.cleanup()
    def write(self,**updates):
        (self.folder/'tracks.json').write_text(json.dumps(self.manifest))
        arrays=dict(track_numbers=np.array([17]),track_vectors=self.mean[None],
            sample_vectors=self.samples,sample_track_numbers=np.array([17,17]),sample_seconds=np.array([0,1]))
        arrays.update(updates);np.savez(self.folder/'embeddings.npz',**arrays)
    def test_mean_from_two_seconds(self):
        _,v=load_bundle(self.folder);self.assertEqual(v.shape,(1,256))
    def test_vector_from_one_frame_instead_of_mean_rejected(self):
        self.write(track_vectors=self.samples[:1])
        with self.assertRaisesRegex(ValueError,'thumbnail mean'):load_bundle(self.folder)
    def test_two_thumbnails_same_second_rejected(self):
        self.manifest['tracks'][0]['samples'][1]['second']=0;self.write()
        with self.assertRaisesRegex(ValueError,'Duplicate'):load_bundle(self.folder)
    def test_wrong_sample_identity_rejected(self):
        self.write(sample_track_numbers=np.array([17,18]))
        with self.assertRaisesRegex(ValueError,'metadata'):load_bundle(self.folder)
    def test_no_timezone_rejected(self):
        self.manifest['recorded_start_at']='2026-11-16T09:00:00';self.write()
        with self.assertRaisesRegex(ValueError,'timezone'):load_bundle(self.folder)
    def test_failed_analysis_rejected(self):
        (self.folder/'FAILED.txt').write_text('failed')
        with self.assertRaisesRegex(ValueError,'Incomplete'):load_bundle(self.folder)
if __name__=='__main__':unittest.main()
