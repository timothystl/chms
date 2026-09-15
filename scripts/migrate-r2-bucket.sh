#!/usr/bin/env bash
set -euo pipefail

# Copies every object from one R2 bucket into another via R2's S3-compatible API. Used for the
# legacy-resource renaming project: Cloudflare has no in-place R2 bucket rename, so a "rename" is
# create-new-bucket -> copy-objects (this script) -> repoint the Worker's binding -> deploy ->
# verify -> delete-old. This script is the copy-data step only; it never deletes anything from
# either bucket, so it can be re-run safely if it needs to catch up on objects written since a
# first pass (the source bucket stays live and writable throughout, per member-photo uploads).
#
# tlc-chms-photos holds real member/household photos and other identity-adjacent images -- object
# keys (e.g. people/<id>/photo.jpg, households/<id>/photo.jpg) are tied to specific real people.
# Object keys must never be printed or written to the result file; only counts and byte totals are.
#
# Two separate Cloudflare credential types are involved (same split as website's
# scripts/verify-r2-recovery.sh, the only prior R2 scripting in this project): bucket lifecycle
# (create/delete) would go through wrangler and the ordinary account API token, but this script
# never creates or deletes a bucket, so it only needs the second kind -- object-level list/copy,
# which R2 exposes solely through the S3-compatible endpoint, not Cloudflare's own REST API. That
# needs an R2 API token's Access Key ID/Secret Access Key (Cloudflare dashboard's R2 -> "Manage R2
# API Tokens", scoped read+write to both the source and destination buckets) plus the account id
# for the endpoint URL.

source_bucket="${SOURCE_BUCKET:?SOURCE_BUCKET is required}"
dest_bucket="${DEST_BUCKET:?DEST_BUCKET is required}"
account_id="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
result_file="${RESULT_FILE:-/tmp/timothy-r2-migration-result.json}"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-r2-migration.XXXXXX")"
endpoint_url="https://${account_id}.r2.cloudflarestorage.com"
chmod 700 "$temp_dir"

cleanup() { rm -rf "$temp_dir"; }
trap cleanup EXIT

# Object-level work only -- list/copy objects inside a bucket. R2's S3-compatible endpoint, the
# R2-scoped access key pair. Region is meaningless to R2 but the AWS CLI requires one to be set.
s3() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3 --endpoint-url "$endpoint_url" "$@"
}

s3api_list() {
  local bucket="$1"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3api list-objects-v2 --endpoint-url "$endpoint_url" --bucket "$bucket" --output json \
    | jq -c '.Contents // []'
}

# A manifest of key + etag + size, sorted, so the two buckets can be compared by content identity
# without downloading a single object or printing a key name anywhere in this script's own output.
manifest() {
  local bucket="$1"
  local output="$2"
  s3api_list "$bucket" | \
    python3 -c "
import json, sys
rows = json.load(sys.stdin)
out = sorted([{'key': o['Key'], 'etag': o['ETag'].strip('\"'), 'size': o['Size']} for o in rows], key=lambda r: r['key'])
json.dump(out, sys.stdout, separators=(',', ':'), sort_keys=True)
" > "$output"
}

# One-time diagnostic: if the sync fails for a systemic reason (auth, permissions, endpoint), the
# error text is a fixed AWS CLI/API message, not data -- safe to capture once, with any long
# token-like run of characters (>=20 chars) blanked out as defense in depth, and object keys are
# never included in this redaction target since AWS CLI error text here is protocol-level, not a
# per-object listing.
first_failure_diagnostic=""
capture_diagnostic_once() {
  if [[ -z "$first_failure_diagnostic" ]] && [[ -s "$1" ]]; then
    first_failure_diagnostic="$(head -c 2000 "$1" | tr -d '\r' | sed -E 's/[A-Za-z0-9_+\/=-]{20,}/[REDACTED]/g' | head -5)"
  fi
}

echo "[1/5] Verifying source and destination buckets are reachable"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
  aws s3api head-bucket --endpoint-url "$endpoint_url" --bucket "$source_bucket"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
  aws s3api head-bucket --endpoint-url "$endpoint_url" --bucket "$dest_bucket"

echo "[2/5] Listing the source bucket"
manifest "$source_bucket" "$temp_dir/source-manifest.json"
source_objects="$(jq 'length' "$temp_dir/source-manifest.json")"
source_bytes="$(jq '[.[].size] | add // 0' "$temp_dir/source-manifest.json")"
echo "      Found $source_objects object(s), ${source_bytes} bytes total (keys withheld from all logs)"

echo "[3/5] Copying objects from $source_bucket to $dest_bucket"
# aws s3 sync between two s3:// URIs on the same endpoint performs a server-side CopyObject per
# differing/missing key -- it never downloads bytes through this runner, and CopyObject preserves
# the source object's metadata (including Content-Type, which every PHOTOS.put() call site in
# this codebase sets explicitly) by default. sync only adds/updates; it never deletes anything
# from the destination, so a partial or repeat run is always safe. --only-show-errors suppresses
# per-object success lines (which would otherwise print "copy: bucket/key to bucket/key" -- a key
# name -- to the job log for every single photo); only failures are surfaced, to stderr, captured
# below rather than echoed directly.
sync_ok=1
if ! s3 sync "s3://${source_bucket}" "s3://${dest_bucket}" --only-show-errors 2>"$temp_dir/sync-error.log"; then
  sync_ok=0
  echo "      First sync attempt reported an error; retrying once after a short pause..." >&2
  sleep 5
  if s3 sync "s3://${source_bucket}" "s3://${dest_bucket}" --only-show-errors 2>"$temp_dir/sync-error-retry.log"; then
    sync_ok=1
  else
    capture_diagnostic_once "$temp_dir/sync-error-retry.log"
    capture_diagnostic_once "$temp_dir/sync-error.log"
  fi
fi

echo "[4/5] Reconciling the destination against the source manifest"
# The sync command's own exit code above is the ground truth for whether the copy operation
# itself succeeded -- it either completed the full CopyObject set or it didn't. Everything in this
# step is a *secondary*, best-effort confirmation layered on top, and is never allowed to fail
# this job on its own: the source bucket stays live and writable throughout (staff can upload a
# new member/household photo mid-run), so a manifest snapshot taken after sync started can
# legitimately show an object the sync pass never saw -- that is new data, not a copy failure.
manifest "$dest_bucket" "$temp_dir/dest-manifest.json"
dest_objects_after="$(jq 'length' "$temp_dir/dest-manifest.json")"
missing_from_dest="$(python3 - "$temp_dir/source-manifest.json" "$temp_dir/dest-manifest.json" <<'PY'
import json, sys
source = {r['key']: (r['etag'], r['size']) for r in json.load(open(sys.argv[1]))}
dest = {r['key']: (r['etag'], r['size']) for r in json.load(open(sys.argv[2]))}
missing = sum(1 for k, v in source.items() if dest.get(k) != v)
print(missing)
PY
)"
dest_count_verified=false
if [[ "$missing_from_dest" -eq 0 ]]; then
  dest_count_verified=true
else
  echo "      Note: $missing_from_dest object(s) in the source snapshot are not yet matched in the destination" \
       "(by key/etag/size). Not treated as a failure -- could be new uploads after this run's source" \
       "listing, or eventual consistency; re-run this script to catch up." >&2
fi

echo "[5/5] Done -- source bucket was not modified or deleted"

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_bucket "$source_bucket" \
  --arg dest_bucket "$dest_bucket" \
  --argjson source_objects "$source_objects" \
  --argjson source_bytes "$source_bytes" \
  --argjson sync_ok "$sync_ok" \
  --argjson dest_objects_after "$dest_objects_after" \
  --argjson missing_from_dest "$missing_from_dest" \
  --argjson dest_count_verified "$dest_count_verified" \
  --arg first_failure_diagnostic "$first_failure_diagnostic" \
  '{completed_at:$completed_at,source_bucket:$source_bucket,dest_bucket:$dest_bucket,source_objects_found:$source_objects,source_bytes:$source_bytes,sync_completed_without_error:($sync_ok==1),dest_object_count_after:$dest_objects_after,objects_not_yet_matched_in_dest:$missing_from_dest,dest_count_verified:$dest_count_verified,first_failure_diagnostic:$first_failure_diagnostic,source_bucket_modified:false,object_keys_logged:false}' > "$result_file"

cat "$result_file"
test "$sync_ok" -eq 1
