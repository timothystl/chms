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

# A key whose remaining life is too short can expire in the gap between listing it and
# writing it to the destination (get, then put, are two separate round trips); treat anything
# expiring within this grace window as already-expired rather than counting it as a failure.
expiry_grace_seconds=30

copied=0
skipped_expired=0
failed=0
# Failure reason buckets -- categorized from wrangler's own exit status/stderr by pattern only,
# never from the stderr text itself, so a key name or value occurring in an error message is
# never captured here.
failed_rate_limited=0
failed_expired_race=0
failed_other=0
# One-time diagnostic: if every attempt fails for the same systemic reason (auth, CLI syntax,
# permissions), the error text is a fixed CLI/API message, not data -- so it's safe to capture
# it once, with any long token-like run of characters (>=20 chars) blanked out as defense in
# depth against an unexpected key name or secret ending up in a wrangler error message.
first_failure_diagnostic=""
capture_diagnostic_once() {
  if [[ -z "$first_failure_diagnostic" ]] && [[ -s "$1" ]]; then
    first_failure_diagnostic="$(head -c 2000 "$1" | tr -d '\r' | sed -E 's/[A-Za-z0-9_+\/=-]{20,}/[REDACTED]/g' | head -5)"
  fi
}

classify_and_run() {
  # Runs "$@", retrying once after a short pause on failure (handles transient network/API
  # blips). Returns wrangler's final exit code; on failure, sets CLASSIFY_REASON to one of
  # rate_limited / expired_race / other based only on the exit code and a keyword scan of the
  # captured stderr file (never the stderr content itself).
  local error_log="$1"; shift
  if wrangler "$@" 2>"$error_log"; then
    return 0
  fi
  sleep 2
  if wrangler "$@" 2>"$error_log"; then
    return 0
  fi
  if grep -qiE '429|rate.?limit|too many requests' "$error_log"; then
    CLASSIFY_REASON=rate_limited
  elif grep -qiE 'expir' "$error_log"; then
    CLASSIFY_REASON=expired_race
  else
    CLASSIFY_REASON=other
  fi
  return 1
}

key_index=0
while [[ "$key_index" -lt "$total_keys" ]]; do
  name="$(jq -r ".[$key_index].name" "$temp_dir/source-keys.json")"
  expiration="$(jq -r ".[$key_index].expiration // empty" "$temp_dir/source-keys.json")"
  key_index=$((key_index + 1))

  if [[ -n "$expiration" ]] && [[ "$expiration" -le "$((now_epoch + expiry_grace_seconds))" ]]; then
    skipped_expired=$((skipped_expired + 1))
    continue
  fi

  value_file="$temp_dir/value.$$"
  if ! classify_and_run "$temp_dir/get-error.log" kv key get --namespace-id="$source_namespace_id" --remote --text -- "$name" > "$value_file"; then
    failed=$((failed + 1))
    capture_diagnostic_once "$temp_dir/get-error.log"
    case "$CLASSIFY_REASON" in
      rate_limited) failed_rate_limited=$((failed_rate_limited + 1)) ;;
      expired_race) failed_expired_race=$((failed_expired_race + 1)) ;;
      *) failed_other=$((failed_other + 1)) ;;
    esac
    rm -f "$value_file"
    continue
  fi

  put_args=(kv key put --namespace-id="$dest_namespace_id" --remote --path="$value_file")
  if [[ -n "$expiration" ]]; then
    put_args+=(--expiration="$expiration")
  fi
  put_args+=(-- "$name")

  if classify_and_run "$temp_dir/put-error.log" "${put_args[@]}" >/dev/null; then
    copied=$((copied + 1))
  else
    failed=$((failed + 1))
    capture_diagnostic_once "$temp_dir/put-error.log"
    case "$CLASSIFY_REASON" in
      rate_limited) failed_rate_limited=$((failed_rate_limited + 1)) ;;
      expired_race) failed_expired_race=$((failed_expired_race + 1)) ;;
      *) failed_other=$((failed_other + 1)) ;;
    esac
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
  if [[ -n "$expiration" ]] && [[ "$expiration" -le "$((now_epoch + expiry_grace_seconds))" ]]; then continue; fi

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
  --argjson failed_rate_limited "$failed_rate_limited" \
  --argjson failed_expired_race "$failed_expired_race" \
  --argjson failed_other "$failed_other" \
  --argjson dest_count_after "$dest_count_after" \
  --argjson sample_checked "$sample_checked" \
  --argjson sample_matched "$sample_matched" \
  --arg first_failure_diagnostic "$first_failure_diagnostic" \
  '{completed_at:$completed_at,source_namespace_id:$source_namespace_id,source_namespace_title:$source_namespace_title,dest_namespace_id:$dest_namespace_id,dest_namespace_title:$dest_namespace_title,total_keys_found:$total_keys,copied:$copied,skipped_expired:$skipped_expired,failed:$failed,failed_rate_limited:$failed_rate_limited,failed_expired_race:$failed_expired_race,failed_other:$failed_other,dest_key_count_after:$dest_count_after,sample_checked:$sample_checked,sample_matched:$sample_matched,first_failure_diagnostic:$first_failure_diagnostic,source_namespace_modified:false,key_names_and_values_logged:false}' > "$result_file"

cat "$result_file"
test "$failed" -eq 0
