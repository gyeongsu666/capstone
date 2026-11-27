#!/usr/bin/env bash
# docs 브랜치의 openapi.json을 backend/openapi/에 복사한 뒤 실행한다. 결과: app/schemas_gen.py(손으로 고치지 않는다)
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHONUTF8=1 datamodel-codegen \
  --input openapi/openapi.json --input-file-type openapi \
  --output app/schemas_gen.py --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.11 --use-annotated --field-constraints --use-standard-collections \
  --use-union-operator --enum-field-as-literal all --use-schema-description \
  --disable-timestamp --use-double-quotes
