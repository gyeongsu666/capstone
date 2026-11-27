#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ -n "${DATABASE_URL:-}" ]]; then
  exec "$ROOT/.venv/bin/python" "$ROOT/scripts/tracklet_pipeline.py" query "$@"
fi
exec "$ROOT/.venv/bin/python" "$ROOT/scripts/local_db.py" run \
  "$ROOT/.venv/bin/python" "$ROOT/scripts/tracklet_pipeline.py" query "$@"
