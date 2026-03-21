#!/bin/sh
set -eu

until mc alias set local http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"; do
  echo "Waiting for MinIO..."
  sleep 2
done

mc mb --ignore-existing local/"${S3_BUCKET}"
mc anonymous set none local/"${S3_BUCKET}"
