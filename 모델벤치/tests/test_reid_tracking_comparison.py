"""Reference-photo and scene-ranking regressions; no model/video execution."""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

path = Path(__file__).resolve().parents[1] / "06_compare_reid_tracking.py"
spec = importlib.util.spec_from_file_location("reid_search", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReIDPhotoSearchTests(unittest.TestCase):
    def test_defaults_use_person_3_and_match_intel_search_conditions(self):
        args = module.parse_args([])
        self.assertEqual(args.image.name, "person_3.png")
        self.assertEqual(args.video.name, "video_1.mp4")
        self.assertEqual((args.imgsz, args.conf, args.iou, args.interval, args.top_k),
                         (640, 0.3, 0.7, 1.0, 5))
        self.assertEqual(args.reid_model.name, "yolo26n-reid.onnx")
        self.assertEqual(args.output_root.name, "yolo26n_reid_results")

    def test_cuda_cannot_silently_fall_back_to_cpu(self):
        with self.assertRaisesRegex(RuntimeError, "CPU fallback"):
            module.require_provider("cuda:0", ["CPUExecutionProvider"])
        with self.assertRaises(RuntimeError):
            module.require_provider("cuda:0", ["CPUExecutionProvider", "CUDAExecutionProvider"])
        module.require_provider("cuda:0", ["CUDAExecutionProvider", "CPUExecutionProvider"])
        module.require_provider("cpu", ["CPUExecutionProvider"])

    def test_cuda13_runtime_cannot_use_pytorch_cuda12_dlls(self):
        with self.assertRaisesRegex(RuntimeError, "PyTorch uses CUDA 12.6"):
            module.require_cuda_major_match("12.6", "13.0")
        module.require_cuda_major_match("12.6", "12.6")
        module.require_cuda_major_match("12.6", None)

    def test_static_rectangular_input_and_dynamic_fallback(self):
        self.assertEqual(module.reid_input_size([1, 3, 256, 128], 448, "tensor(float)"), (256, 128))
        self.assertEqual(module.reid_input_size(["N", 3, "H", "W"], 448, "tensor(float)"), (448, 448))

    def test_incompatible_batch_or_precision_is_rejected(self):
        for shape, dtype in [([8, 3, 448, 448], "tensor(float)"),
                             ([1, 3, 448, 448], "tensor(float16)"),
                             ([1, 448, 448, 3], "tensor(float)")]:
            with self.assertRaises(ValueError):
                module.reid_input_size(shape, 448, dtype)

    def test_full_photo_and_exact_unpadded_crop_reach_encoder_in_rgb(self):
        # A tiny tensor substitute exercises our real embed() without torch/ORT/models.
        class Tensor:
            def __init__(self, array):
                self.array = array

            def permute(self, *dims):
                return Tensor(self.array.transpose(dims))

            def unsqueeze(self, axis):
                return Tensor(np.expand_dims(self.array, axis))

            def float(self):
                return Tensor(self.array.astype(np.float32))

            def __truediv__(self, value):
                return Tensor(self.array / value)

            def numpy(self):
                return self.array

        resize = Mock(side_effect=lambda tensor, **kwargs: tensor)
        encoder = module.OnnxReIDEncoder.__new__(module.OnnxReIDEncoder)
        encoder.np = np
        encoder.torch = SimpleNamespace(from_numpy=Tensor, nn=SimpleNamespace(
            functional=SimpleNamespace(interpolate=resize)))
        encoder.input_size = (448, 448)
        encoder.input = SimpleNamespace(name="images")
        encoder.output = SimpleNamespace(name="features")
        encoder.session = SimpleNamespace(run=Mock(return_value=[np.array([[3., 4.]], dtype=np.float32)]))
        encoder.dimension = None
        image = np.arange(6 * 8 * 3, dtype=np.uint8).reshape(6, 8, 3)
        original = image.copy()
        for bgr in (image, image[1:5, 2:7]):
            vector = encoder.embed(bgr)
            fed = encoder.session.run.call_args.args[1]["images"]
            self.assertEqual(fed.shape, (1, 3, *bgr.shape[:2]))
            np.testing.assert_allclose(fed[0, 0], bgr[..., 2] / np.float32(255.))
            np.testing.assert_allclose(fed[0, 2], bgr[..., 0] / np.float32(255.))
            np.testing.assert_allclose(vector, [.6, .8])
        np.testing.assert_array_equal(image, original)
        self.assertEqual(resize.call_args.kwargs,
                         {"size": (448, 448), "mode": "bilinear", "align_corners": False})
        encoder.session.run.return_value = [np.zeros((1, 2), dtype=np.float32)]
        with self.assertRaisesRegex(ValueError, "invalid embedding"):
            encoder.embed(image)

    def test_top5_contains_distinct_frames_and_best_score_per_frame(self):
        class Frame:
            def copy(self):
                return "saved frame"

        scenes = []
        for frame, score in [(1, .5), (2, .6), (3, .7), (4, .8), (5, .9), (6, .95), (3, .99)]:
            module.retain_scene(scenes, {"frame_1based": frame, "cosine_similarity": score}, Frame(), 5)
        self.assertEqual([item["frame_1based"] for item in scenes], [3, 6, 5, 4, 2])
        self.assertEqual(len({item["frame_1based"] for item in scenes}), 5)

    def test_lower_score_cannot_replace_existing_scene_for_the_same_frame(self):
        class Frame:
            def copy(self):
                return "saved frame"

        scenes = []
        for score in (.8, .7):
            module.retain_scene(scenes, {"frame_1based": 1, "cosine_similarity": score}, Frame(), 5)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0]["cosine_similarity"], .8)


if __name__ == "__main__":
    unittest.main()
