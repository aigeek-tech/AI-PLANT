#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit passwords and public endpoints before production use."
fi

set -a
. ./.env
set +a

if [ ! -f config/backend.env ]; then
  cp config/backend.env.example config/backend.env
  echo "Created config/backend.env from config/backend.env.example."
fi

mkdir -p data/postgres data/minio data/document-conversion

if [ "${USE_EXTERNAL_MINIO:-false}" = "true" ]; then
  COMPOSE_PROFILES=""
else
  COMPOSE_PROFILES="internal-minio"
fi

docker compose --env-file .env -f docker-compose.offline.yml -f docker-compose.aliyun.yml pull

if [ -n "$COMPOSE_PROFILES" ]; then
  docker compose --env-file .env --profile "$COMPOSE_PROFILES" -f docker-compose.offline.yml -f docker-compose.aliyun.yml up -d postgres minio kkfileview
  docker compose --env-file .env --profile "$COMPOSE_PROFILES" -f docker-compose.offline.yml -f docker-compose.aliyun.yml run --rm minio-init
  docker compose --env-file .env --profile "$COMPOSE_PROFILES" -f docker-compose.offline.yml -f docker-compose.aliyun.yml up -d backend document-converter frontend
else
  docker compose --env-file .env -f docker-compose.offline.yml -f docker-compose.aliyun.yml up -d postgres kkfileview
  docker compose --env-file .env -f docker-compose.offline.yml -f docker-compose.aliyun.yml run --rm minio-init
  docker compose --env-file .env -f docker-compose.offline.yml -f docker-compose.aliyun.yml up -d backend document-converter frontend
fi
