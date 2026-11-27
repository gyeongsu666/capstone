#!/usr/bin/env bash
# LEFT 백엔드 운영 도우미. 저장소 루트에서 실행한다.
#   scripts/left.sh init                     .env 만들기(비밀값 자동 생성), 미디어 폴더 준비
#   scripts/left.sh up [서비스...]            빌드 후 실행(기본: 전체)
#   scripts/left.sh down                     중지(데이터는 남는다)
#   scripts/left.sh migrate                  DB 스키마를 최신으로
#   scripts/left.sh create-admin <아이디> <이름>
#   scripts/left.sh seed-demo-settings       시연용 임시 설정값(비어 있을 때만)
#   scripts/left.sh check                    API 상태 + CPU·GPU 워커 왕복 확인
#   scripts/left.sh gpu-check                호스트에서 컨테이너가 GPU를 쓸 수 있는지 확인
#   scripts/left.sh logs [서비스]             로그 보기
#   scripts/left.sh ps                       상태 보기
#   scripts/left.sh psql                     DB 접속
set -euo pipefail
cd "$(dirname "$0")/.."

compose() { docker compose "$@"; }
api_exec() { compose exec -T api "$@"; }

cmd="${1:-help}"
shift || true
case "$cmd" in
  init)
    python3 scripts/init_env.py
    mkdir -p data/media
    echo "모델 가중치·영상(Git LFS)이 없으면: git lfs pull --include='모델벤치/*.pt,모델벤치/models/**'"
    ;;
  up)
    compose up --build -d --wait "$@"
    compose ps
    ;;
  down)
    compose down
    ;;
  migrate)
    api_exec alembic upgrade head
    ;;
  create-admin)
    [[ $# -eq 2 ]] || { echo "사용: scripts/left.sh create-admin <아이디> <이름>" >&2; exit 2; }
    api_exec python -m app.cli create-admin "$1" "$2"
    ;;
  seed-demo-settings)
    api_exec python -m app.cli seed-demo-settings
    ;;
  check)
    port="$(grep -E '^API_PORT=' .env 2>/dev/null | cut -d= -f2)"
    curl -fsS "http://127.0.0.1:${port:-8000}/api/health" && echo
    api_exec python -m app.cli check-workers
    ;;
  gpu-check)
    docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
    ;;
  logs)
    compose logs -f --tail 200 "$@"
    ;;
  ps)
    compose ps
    ;;
  psql)
    compose exec db psql -U capstone -d capstone
    ;;
  *)
    sed -n '2,15p' "$0"
    ;;
esac
