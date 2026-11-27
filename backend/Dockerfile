# api 이미지. 워커(CPU·GPU)는 Dockerfile.gpu를 쓴다.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt /tmp/req/
RUN pip install -r /tmp/req/requirements.txt

COPY backend /app/backend
COPY scripts/model_db.py scripts/tracklet_pipeline.py /app/scripts/
WORKDIR /app/backend

RUN useradd --create-home --uid 1000 left && mkdir -p /data/media && chown -R left /data/media
USER left
