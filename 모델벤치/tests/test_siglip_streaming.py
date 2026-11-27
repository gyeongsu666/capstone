"""Small synthetic checkpoint checks; no models, torch, downloads or inference."""

import io
import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from siglip_streaming import vision_tensors


def checkpoint(header, data):
    encoded = json.dumps(header).encode("utf-8")
    return io.BytesIO(len(encoded).to_bytes(8, "little") + encoded + data)


class StreamingWeightsTests(unittest.TestCase):
    def test_vision_data_matches_and_text_data_is_not_read(self):
        class RecordingFile(io.BytesIO):
            def readinto(self, buffer):
                self.byte_count += len(buffer)
                return super().readinto(buffer)

        header = {
            "text_model.weight": {"shape": [3], "dtype": "F32", "data_offsets": [0, 12]},
            "vision_model.weight": {"shape": [2], "dtype": "F32", "data_offsets": [12, 20]},
        }
        stream = RecordingFile(checkpoint(header, struct.pack("<5f", 9, 8, 7, 1, 2)).getvalue())
        stream.byte_count = 0
        rows = list(vision_tensors(stream, {"weight": (2,)}))
        self.assertEqual(rows[0][:3], ("weight", "F32", [2]))
        self.assertEqual(struct.unpack("<2f", rows[0][3]), (1, 2))
        self.assertEqual(stream.byte_count, 8)

    def test_prefixed_model_keys(self):
        stream = checkpoint({"vision_model.weight": {
            "shape": [1], "dtype": "F32", "data_offsets": [0, 4],
        }}, struct.pack("<f", 3))
        rows = list(vision_tensors(stream, {"vision_model.weight": (1,)}))
        self.assertEqual(rows[0][0], "vision_model.weight")

    def test_missing_weights_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            list(vision_tensors(checkpoint({}, b""), {"weight": (2,)}))

    def test_wrong_shape_is_rejected(self):
        stream = checkpoint({"vision_model.weight": {
            "shape": [1], "dtype": "F32", "data_offsets": [0, 4],
        }}, b"1234")
        with self.assertRaisesRegex(ValueError, "shape mismatch"):
            list(vision_tensors(stream, {"weight": (2,)}))

    def test_truncated_data_is_rejected(self):
        stream = checkpoint({"vision_model.weight": {
            "shape": [2], "dtype": "F32", "data_offsets": [0, 8],
        }}, b"1234")
        with self.assertRaisesRegex(ValueError, "truncated"):
            list(vision_tensors(stream, {"weight": (2,)}))

    def test_invalid_header_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "header"):
            list(vision_tensors(io.BytesIO(b"short"), {}))


if __name__ == "__main__":
    unittest.main()
