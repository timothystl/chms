#!/usr/bin/env bash
set -euo pipefail

# Copies every live key from one Workers KV namespace into another, preserving each key's
# remaining absolute expiration. Used for the legacy-resource renaming project: Cloudflare has
# no in-place KV rename, so a "rename" is create-new -> copy-data -> repoint the Worker's
# binding -> deploy -> verify -> delete-old. This script is the copy-data step only; it never
# deletes anything, so it can be re-run safely if it needs to catch up on keys written after a
# first pass.
#
# RSVP_STORE holds password-reset tokens, member-invite tokens (email + name), and
# rate-limit counters keyed by IP address -- all of it sensitive. Key names and values must
# never be printed or written to the result file; only counts are.

source_namespace_id="${SOURCE_NAMESPACE_ID:?SOURCE_NAMESPACE_ID is required}"
source_namespace_title="${SOURCE_NAMESPACE_TITLE:?SOURCE_NAMESPACE_TITLE is required}"
dest_namespace_id="${DEST_NAMESPACE_ID:?DEST_NAMESPACE_ID is required}"
dest_namespace_title="${DEST_NAMESPACE_TITLE:?DEST_NAMESPACE_TITLE is required}"
result_file="${RESULT_FILE:-/tmp/timothy-kv-migration-result.json}"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-kv-migration.XXXXXX")"
chmod 700 "$temp_dir"

cleanup() {
  python3 - "$temp_dir" <<'PY'
import shutil, sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

wrangler() {
  WRANGLER_LOG_PATH="$temp_dir/wrangler.log" npx wrangler "$@"
}

echo "[1/4] Verifying source and destination namespace identity"
wrangler kv namespace list > "$temp_dir/namespaces.json"
for pair in "source:$source_namespace_id:$source_namespace_title" "dest:$dest_namespace_id:$dest_namespace_title"; do
  IFS=':' read -r role id title <<< "$pair"
  jq -e --arg id "$id" --arg title "$title" 'any(.[]; .id == $id and .title == $title)' "$temp_dir/namespaces.json" >/dev/null
done

echo "[2/4] Listing keys in the source namespace"
wrangler kv key list --namespace-id="$source_namespace_id" --remote > "$temp_dir/source-keys.json"
total_keys="$(jq 'length' "$temp_dir/source-keys.json")"
now_epoch="$(date -u +%s)"

echo "      Found $total_keys key(s) (names and values withheld from all logs)"

copied=0
skipped_expired=0
failed=0

key_index=0
while [[ "$key_index" -lt "$total_keys" ]]; do
  name="$(jq -r ".[$key_index].name" "$temp_dir/source-keys.json")"
  expiration="$(jq -r ".[$key_index].expiration // empty" "$temp_dir/source-keys.json")"
  key_index=$((key_index + 1))

  if [[ -n "$expiration" ]] && [[ "$expiration" -le "$now_epoch" ]]; then
    skipped_expired=$((skipped_expired + 1))
    continue
  fi

  value_file="$temp_dir/value.$$"
  if ! wrangler kv key get --namespace-id="$source_namespace_id" --remote --text -- "$name" > "$value_file" 2>"$temp_dir/get-error.log"; then
    failed=$((failed + 1))
    rm -f "$value_file"
    continue
  fi

  put_args=(kv key put --namespace-id="$dest_namespace_id" --remote --path="$value_file")
  if [[ -n "$expiration" ]]; then
    put_args+=(--expiration="$expiration")
  fi
  put_args+=(-- "$name")

  if wrangler "${put_args[@]}" >/dev/null 2>"$temp_dir/put-error.log"; then
    copied=$((copied + 1))
  else
    failed=$((failed + 1))
  fi
  rm -f "$value_file"
done

echo "[3/4] Verifying destination key count and a byte-equality sample"
wrangler kv key list --namespace-id="$dest_namespace_id" --remote > "$temp_dir/dest-keys-after.json"
dest_count_after="$(jq 'length' "$temp_dir/dest-keys-after.json")"
test "$dest_count_after" -eq "$copied"

sample_checked=0
sample_matched=0
sample_size=5
key_index=0
while [[ "$key_index" -lt "$total_keys" ]] && [[ "$sample_checked" -lt "$sample_size" ]]; do
  name="$(jq -r ".[$key_index].name" "$temp_dir/source-keys.json")"
  expiration="$(jq -r ".[$key_index].expiration // empty" "$temp_dir/source-keys.json")"
  key_index=$((key_index + 1))
  if [[ -n "$expiration" ]] && [[ "$expiration" -le "$now_epoch" ]]; then continue; fi

  if wrangler kv key get --namespace-id="$source_namespace_id" --remote --text -- "$name" > "$temp_dir/sample-source.$$" 2>/dev/null \
    && wrangler kv key get --namespace-id="$dest_namespace_id" --remote --text -- "$name" > "$temp_dir/sample-dest.$$" 2>/dev/null; then
    sample_checked=$((sample_checked + 1))
    if cmp -s "$temp_dir/sample-source.$$" "$temp_dir/sample-dest.$$"; then
      sample_matched=$((sample_matched + 1))
    fi
  fi
  rm -f "$temp_dir/sample-source.$$" "$temp_dir/sample-dest.$$"
done
test "$sample_matched" -eq "$sample_checked"

echo "[4/4] Done -- source namespace was not modified or deleted"

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_namespace_id "$source_namespace_id" \
  --arg source_namespace_title "$source_namespace_title" \
  --arg dest_namespace_id "$dest_namespace_id" \
  --arg dest_namespace_title "$dest_namespace_title" \
  --argjson total_keys "$total_keys" \
  --argjson copied "$copied" \
  --argjson skipped_expired "$skipped_expired" \
  --argjson failed "$failed" \
  --argjson dest_count_after "$dest_count_after" \
  --argjson sample_checked "$sample_checked" \
  --argjson sample_matched "$sample_matched" \
  '{completed_at:$completed_at,source_namespace_id:$source_namespace_id,source_namespace_title:$source_namespace_title,dest_namespace_id:$dest_namespace_id,dest_namespace_title:$dest_namespace_title,total_keys_found:$total_keys,copied:$copied,skipped_expired:$skipped_expired,failed:$failed,dest_key_count_after:$dest_count_after,sample_checked:$sample_checked,sample_matched:$sample_matched,source_namespace_modified:false,key_names_and_values_logged:false}' > "$result_file"

test "$failed" -eq 0
cat "$result_file"
