#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit passwords and public endpoints before production use."
fi

if [ ! -f config/backend.env ]; then
  cp config/backend.env.example config/backend.env
  echo "Created config/backend.env from config/backend.env.example."
fi

mkdir -p data/postgres data/minio data/document-conversion

docker compose --env-file .env -f docker-compose.offline.yml up -d

