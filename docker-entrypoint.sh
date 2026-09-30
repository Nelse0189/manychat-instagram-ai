#!/bin/sh
set -eu

if [ "${SKIP_MEDIA_CHECK:-}" = "1" ]; then
  echo "media check skipped"
else
  dir=/app/media/hernandez_sari_
  if [ ! -d "$dir" ]; then
    echo "media directory missing: $dir" >&2
    exit 1
  fi

  count=$(find "$dir" -type f | wc -l)
  largest=$(find "$dir" -type f -printf '%s\n' | sort -n | tail -1)
  echo "media files=${count} largest=${largest}"

  if [ "${largest:-0}" -lt 1000 ]; then
    echo "media files are not the real library" >&2
    exit 1
  fi
fi

exec ./node_modules/.bin/tsx src/index.ts
