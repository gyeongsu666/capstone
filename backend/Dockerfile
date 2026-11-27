# api / worker-cpu 공용 이미지. worker-cpu는 EXTRA_REQUIREMENTS로 OpenVINO 등을 더 설치한다.
FROM python:3.12-slim-bookworm

ARG EXTRA_REQUIREMENTS=""
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements-cpu-worker.txt /tmp/req/
RUN pip install -r /tmp/req/requirements.txt \
    && if [ -n "$EXTRA_REQUIREMENTS" ]; then pip install -r /tmp/req/$(basename "$EXTRA_REQUIREMENTS"); fi

COPY backend /app/backend
COPY scripts/model_db.py scripts/tracklet_pipeline.py /app/scripts/
WORKDIR /app/backend

RUN useradd --create-home --uid 1000 left && mkdir -p /data/media && chown -R left /data/media
USER left
