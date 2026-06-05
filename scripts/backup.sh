#!/usr/bin/env bash
set -euo pipefail
# Run on the VPS host. Dumps the Postgres container DB and uploads offsite.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/portside-${STAMP}.sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U portside portside | gzip > "${OUT}"
# Upload to S3-compatible storage (requires awscli configured with the bucket creds):
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${OUT}" "s3://${S3_BACKUP_BUCKET}/db/portside-${STAMP}.sql.gz"
rm -f "${OUT}"
echo "Backup uploaded: portside-${STAMP}.sql.gz"
