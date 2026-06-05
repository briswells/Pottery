#!/usr/bin/env bash
set -euo pipefail
# Run on the VPS host. Dumps the Postgres container DB and uploads offsite.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/portside-${STAMP}.sql.gz"
# Always clean up the local dump, even if the upload fails.
trap 'rm -f "${OUT}"' EXIT
# pipefail (set above) makes the pipeline fail if pg_dump fails.
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U portside portside | gzip > "${OUT}"
# Guard against uploading an empty/truncated dump that somehow exited 0.
if [ ! -s "${OUT}" ]; then
  echo "Backup aborted: dump is empty (${OUT})" >&2
  exit 1
fi
# Upload to S3-compatible storage (requires awscli configured with the bucket creds):
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${OUT}" "s3://${S3_BACKUP_BUCKET}/db/portside-${STAMP}.sql.gz"
echo "Backup uploaded: portside-${STAMP}.sql.gz"
