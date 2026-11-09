"""Read only SigLIP vision weights without memory-mapping the full checkpoint.

The public Google checkpoint contains both image and text weights. On Windows,
opening it can fail with error 1455 before inference. Read its safetensors header
and copy one required tensor at a time into the model on the selected device.
Format: https://github.com/safetensors/safetensors#format
No ML libraries are imported until load_siglip_vision() is called.
"""

import json
import math
import sys


DTYPE_BYTES = {"F32": 4, "F16": 2, "BF16": 2}


def vision_tensors(stream, expected_shapes):
    """Yield validated (model key, dtype, shape, bytes), excluding text weights."""
    stream.seek(0, 2)
    file_size = stream.tell()
    stream.seek(0)
    prefix = stream.read(8)
    if len(prefix) != 8:
        raise ValueError("Truncated safetensors header length")
    header_size = int.from_bytes(prefix, "little")
    if not 2 <= header_size <= min(100_000_000, file_size - 8):
        raise ValueError("Invalid safetensors header length")
    header = json.loads(stream.read(header_size))
    data_start = 8 + header_size
    if not isinstance(header, dict):
        raise ValueError("Safetensors header must be an object")
    loaded = set()
    for checkpoint_key, info in header.items():
        if checkpoint_key == "__metadata__":
            continue
        # Transformers 5 exposes vision submodules directly; older versions keep
        # a vision_model prefix. Match only exact expected state-dict keys.
        if not checkpoint_key.startswith("vision_model."):
            continue
        candidates = (checkpoint_key, checkpoint_key.removeprefix("vision_model."))
        key = next((name for name in candidates if name in expected_shapes), None)
        if key is None:
            continue
        if key in loaded:
            raise ValueError(f"Duplicate vision weight: {key}")
        shape = info.get("shape")
        if shape != list(expected_shapes[key]):
            raise ValueError(f"Vision weight shape mismatch: {key}")
        dtype = info.get("dtype")
        if dtype not in DTYPE_BYTES:
            raise ValueError(f"Unsupported vision weight dtype: {dtype}")
        offsets = info.get("data_offsets")
        if (not isinstance(offsets, list) or len(offsets) != 2
                or any(type(value) is not int for value in offsets)):
            raise ValueError(f"Invalid weight offsets: {key}")
        start, end = offsets
        expected_bytes = math.prod(shape) * DTYPE_BYTES[dtype]
        if (start < 0 or end <= start or end - start != expected_bytes
                or data_start + end > file_size):
            raise ValueError(f"Invalid or truncated weight data: {key}")
        stream.seek(data_start + start)
        data = bytearray(expected_bytes)
        if stream.readinto(data) != expected_bytes:
            raise ValueError(f"Truncated weight data: {key}")
        loaded.add(key)
        yield key, dtype, shape, data
        del data
    missing = set(expected_shapes) - loaded
    if missing:
        sample = ", ".join(sorted(missing)[:5])
        raise ValueError(f"Checkpoint is missing {len(missing)} vision weights: {sample}")


def load_siglip_vision(model_id, device, torch, model_class):
    from huggingface_hub import hf_hub_download
    from transformers import SiglipConfig

    if sys.byteorder != "little":
        raise RuntimeError("Streaming SigLIP loader requires a little-endian host")
    config = SiglipConfig.from_pretrained(model_id)
    checkpoint = hf_hub_download(
        repo_id=model_id, filename="model.safetensors",
        revision=getattr(config, "_commit_hash", None) or "main",
    )
    print(f"Loading SigLIP vision weights directly on {device} (no full-file mapping)...", flush=True)
    # Construct on the target device so a complete CPU model is not also held
    # during GPU loading. Constructors initialize nonpersistent position buffers.
    with torch.device(device):
        model = model_class(config.vision_config)
    model = model.float()
    targets = model.state_dict(keep_vars=True)
    shapes = {name: tuple(tensor.shape) for name, tensor in targets.items()}
    dtypes = {"F32": torch.float32, "F16": torch.float16, "BF16": torch.bfloat16}
    with open(checkpoint, "rb") as stream, torch.no_grad():
        for number, (key, dtype, shape, buffer) in enumerate(vision_tensors(stream, shapes), 1):
            source = torch.frombuffer(buffer, dtype=dtypes[dtype]).reshape(shape)
            # The copy is blocking; release each CPU buffer before reading the next.
            targets[key].copy_(source, non_blocking=False)
            del source, buffer
            if number == 1 or number % 100 == 0 or number == len(targets):
                print(f"SigLIP weights: {number}/{len(targets)}", flush=True)
    return model.eval()
