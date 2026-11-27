#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo '프로젝트 .venv가 없습니다. README_SERVER.md를 확인하세요.' >&2
  exit 1
fi
export YOLO_CONFIG_DIR="$ROOT/.runtime/ultralytics"
export MPLCONFIGDIR="$ROOT/.runtime/matplotlib"
mkdir -p "$YOLO_CONFIG_DIR" "$MPLCONFIGDIR"
cd "$ROOT"
exec "$ROOT/.venv/bin/python" "$ROOT/모델벤치/04_yolo26n_intel.py" --image "$ROOT/모델벤치/person_3.png" --output-root "$ROOT/runs/model" "$@"
