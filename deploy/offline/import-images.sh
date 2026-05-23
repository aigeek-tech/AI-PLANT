#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IMAGE_TAR="${1:-$SCRIPT_DIR/images/smart-design-offline-images.tar}"

if [ ! -f "$IMAGE_TAR" ]; then
  echo "Image tar not found: $IMAGE_TAR" >&2
  exit 1
fi

docker load -i "$IMAGE_TAR"

