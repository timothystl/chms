#!/usr/bin/env bash
set -euo pipefail

# Copies the full schema and data of one D1 database into another, permanent one. Used for the
# legacy-resource renaming project: Cloudflare has no in-place D1 rename and no fork/copy-into-
# new-database capability (confirmed against `wrangler d1 --help`, including `time-travel
# restore`, which restores a named database in place, not into a new one) -- so a "rename" of
# tlc-volunteer-db -> timothy-connect-db is: create the new database (done) -> copy data (this
# script) -> repoint wrangler.toml's binding in a separate PR -> a manual production deploy ->
# verify -> delete-old once confirmed. This script is the copy-data step only; it never touches
# or deletes the source database, so it is safe to re-run to catch up on writes made since a
# prior pass (the source stays live and writable throughout, right up until the deploy that
# repoints the Worker's binding).
#
# This is adapted from scripts/verify-d1-recovery.sh (chms's own tested D1 backup/restore drill)
# and reuses its structure, its run_query/local_query/batched_query helpers, its schema/row-
# count/foreign-key/monetary-control-total reconciliation, and scripts/prepare-d1-import.py
# unchanged for D1's oversized-per-statement limit. It differs from that drill in three ways:
#
#   1. The destination is a fixed, pre-created, PERMANENT database (timothy-connect-db), not a
#      timestamped disposable one -- this script never creates or deletes it.
#   2. Because the destination is permanent and this script must be safely re-runnable (a dry
#      run now, then a final catch-up pass immediately before the real cutover deploy), it drops
#      every existing user table in the destination before each import, so re-running never
#      collides with a prior run's data and the destination's own database id -- already
#      hardcoded into the wrangler.toml repoint PR -- never has to change between runs.
#   3. It adds one reconciliation check the drill deliberately skips: SQLite's AUTOINCREMENT
#      high-water-mark table, `sqlite_sequence`. The drill doesn't need this because its
#      destination is deleted minutes later; a permanent replacement does, so that new
#      `people`/`households`/`giving_entries`/etc. rows inserted after cutover get IDs that
#      continue correctly rather than risking a future collision with already-imported rows.
#
# CRITICAL: this script must be the ONLY thing that ever touches the destination database until
# the wrangler.toml repoint is deployed. It talks to the destination purely via `wrangler d1
# execute` -- never bind it to any Worker and never run `wrangler dev` against it first. chms's
# own `initDb()` (src/db.js) runs on nearly every request and, on any database it doesn't
# recognize via a `chms_config.schema_fingerprint` row, builds the full schema AND inserts real
# hardcoded seed data (real event names, real tuition-aid figures, real property financials)
# using AUTOINCREMENT primary keys starting at 1 -- which would collide with or corrupt the real
# imported data's own primary keys and foreign keys the moment the two data sets meet.

source_db="${SOURCE_DB:-tlc-volunteer-db}"
source_db_id="${SOURCE_DB_ID:?SOURCE_DB_ID is required}"
dest_db="${DEST_DB:-timothy-connect-db}"
dest_db_id="${DEST_DB_ID:?DEST_DB_ID is required}"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-d1-migration.XXXXXX")"
export_file="$temp_dir/tlc-volunteer-db.sql"
import_file="$temp_dir/tlc-volunteer-db-import.sql"
rewrite_metadata="$temp_dir/rewrite-metadata.json"
snapshot_db="$temp_dir/source-snapshot.sqlite"
result_file="${RESULT_FILE:-/tmp/timothy-d1-migration-result.json}"

chmod 700 "$temp_dir"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

wrangler() {
  WRANGLER_LOG_PATH="$temp_dir/wrangler.log" npx wrangler "$@"
}

cleanup() {
  python3 - "$temp_dir" <<'PY'
import shutil, sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

run_query() {
  local database="$1"
  local sql="$2"
  local output="$3"
  local error_output="${output}.stderr"
  if ! wrangler d1 execute "$database" --remote --json --command "$sql" > "$output" 2> "$error_output"; then
    echo "D1 aggregate query failed:"
    tail -n 20 "$error_output"
    jq -c 'if type == "array" then [.[] | {success,error}] else {error:(.error // .errors // .message // null)} end' "$output" 2>/dev/null || true
    return 1
  fi
  jq -e 'type == "array" and all(.[]; .success == true)' "$output" >/dev/null
}

local_query() {
  local database="$1"
  local sql="$2"
  local output="$3"
  python3 - "$database" "$sql" "$output" <<'PY'
import json, sqlite3, sys
database, sql, output = sys.argv[1:]
db=sqlite3.connect(database)
db.row_factory=sqlite3.Row
rows=[dict(row) for row in db.execute(sql).fetchall()]
db.close()
with open(output,'w') as f:
    json.dump([{'success':True,'results':rows}],f,separators=(',',':'))
PY
}

canonical_results() {
  jq -cS '[.[].results[]] | sort_by(tostring)' "$1"
}

batched_query() {
  local mode="$1"
  local database="$2"
  local statements_file="$3"
  local output="$4"
  local rows_file="${output}.rows"
  local batch_file="${output}.batch"
  local batch_sql=""
  local batch_count=0
  echo '[]' > "$rows_file"

  flush_batch() {
    if [[ "$batch_count" == "0" ]]; then return; fi
    if [[ "$mode" == "local" ]]; then
      local_query "$database" "${batch_sql};" "$batch_file"
    else
      run_query "$database" "${batch_sql};" "$batch_file"
    fi
    python3 - "$rows_file" "$batch_file" <<'PY'
import json, sys
rows=json.load(open(sys.argv[1]))
for result in json.load(open(sys.argv[2])):
    rows.extend(result.get('results',[]))
with open(sys.argv[1],'w') as f:
    json.dump(rows,f,separators=(',',':'))
PY
    batch_sql=""
    batch_count=0
  }

  while IFS= read -r statement; do
    if [[ -n "$batch_sql" ]]; then batch_sql+=" UNION ALL "; fi
    batch_sql+="$statement"
    batch_count=$((batch_count + 1))
    if [[ "$batch_count" == "5" ]]; then flush_batch; fi
  done < "$statements_file"
  flush_batch

  python3 - "$rows_file" "$output" <<'PY'
import json, sys
rows=json.load(open(sys.argv[1]))
with open(sys.argv[2],'w') as f:
    json.dump([{'success':True,'results':rows}],f,separators=(',',':'))
PY
}

echo "[1/8] Verifying source and destination D1 identity"
source_info="$temp_dir/source-info.json"
wrangler d1 info "$source_db" --json > "$source_info"
jq -e --arg expected "$source_db_id" '
  (if type == "array" then .[0] else . end)
  | (.uuid // .id) == $expected
' "$source_info" >/dev/null

dest_info="$temp_dir/dest-info.json"
wrangler d1 info "$dest_db" --json > "$dest_info"
jq -e --arg expected "$dest_db_id" '
  (if type == "array" then .[0] else . end)
  | (.uuid // .id) == $expected
' "$dest_info" >/dev/null

echo "[2/8] Exporting the source D1 to protected temporary storage"
wrangler d1 export "$source_db" --remote --output="$export_file" --skip-confirmation >/dev/null
chmod 600 "$export_file"
export_sha="$(sha256_file "$export_file")"
export_bytes="$(wc -c < "$export_file" | tr -d ' ')"

python3 - "$export_file" "$snapshot_db" <<'PY'
from pathlib import Path
import sqlite3, sys
source, database = sys.argv[1:]
db=sqlite3.connect(database)
db.executescript(Path(source).read_text(errors='strict'))
db.close()
PY

python3 scripts/prepare-d1-import.py "$export_file" "$import_file" "$rewrite_metadata"
rewritten_statements="$(jq '.rewritten_statements | length' "$rewrite_metadata")"
rewritten_cells="$(jq '.rewritten_cells | length' "$rewrite_metadata")"
max_statement_after="$(jq '.max_statement_after' "$rewrite_metadata")"

echo "[3/8] Clearing any prior data in the destination (safe re-run, same database id every time)"
table_sql="SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;"
run_query "$dest_db" "$table_sql" "$temp_dir/dest-existing-tables.json"
jq -r '.[].results[].name' "$temp_dir/dest-existing-tables.json" > "$temp_dir/dest-existing-tables.txt"
dest_existing_count="$(wc -l < "$temp_dir/dest-existing-tables.txt" | tr -d ' ')"
if [[ "$dest_existing_count" -gt 0 ]]; then
  {
    echo "PRAGMA foreign_keys=OFF;"
    while IFS= read -r table; do
      [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
      echo "DROP TABLE IF EXISTS \"${table}\";"
    done < "$temp_dir/dest-existing-tables.txt"
  } > "$temp_dir/drop-existing.sql"
  wrangler d1 execute "$dest_db" --remote --file="$temp_dir/drop-existing.sql" --yes >/dev/null
fi
# sqlite_sequence (the AUTOINCREMENT high-water-mark table) is dropped along with its owning
# tables above in real SQLite semantics, but clear it explicitly too in case any row survived
# from a table already removed in an even earlier run -- guarded because it may not exist yet
# on a database that has never held an AUTOINCREMENT table.
run_query "$dest_db" "SELECT name FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence';" "$temp_dir/dest-has-sequence.json"
if [[ "$(jq '[.[].results[]] | length' "$temp_dir/dest-has-sequence.json")" -gt 0 ]]; then
  run_query "$dest_db" "DELETE FROM sqlite_sequence;" "$temp_dir/dest-clear-sequence.json"
fi

echo "[4/8] Loading the source export into the destination"
wrangler d1 execute "$dest_db" --remote --file="$import_file" --yes >/dev/null

if [[ "$rewritten_cells" -gt 0 ]]; then
  cell_index=0
  while [[ "$cell_index" -lt "$rewritten_cells" ]]; do
    table="$(jq -r ".rewritten_cells[$cell_index].table" "$rewrite_metadata")"
    column="$(jq -r ".rewritten_cells[$cell_index].column" "$rewrite_metadata")"
    where_sql="$(jq -r ".rewritten_cells[$cell_index].where_sql" "$rewrite_metadata")"
    expected_characters="$(jq -r ".rewritten_cells[$cell_index].characters" "$rewrite_metadata")"
    expected_bytes="$(jq -r ".rewritten_cells[$cell_index].bytes" "$rewrite_metadata")"
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
    [[ "$column" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
    length_sql="SELECT length(\"${column}\") AS characters, length(CAST(\"${column}\" AS BLOB)) AS bytes FROM \"${table}\" WHERE ${where_sql};"
    run_query "$dest_db" "$length_sql" "$temp_dir/rewrite-length-${cell_index}.json"
    jq -e --argjson characters "$expected_characters" --argjson bytes "$expected_bytes" '[.[].results[]] == [{"characters":$characters,"bytes":$bytes}]' "$temp_dir/rewrite-length-${cell_index}.json" >/dev/null
    cell_index=$((cell_index + 1))
  done
fi

echo "[5/8] Comparing schema, indexes, triggers, and integrity"
schema_sql="SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL ORDER BY type, name;"
local_query "$snapshot_db" "$schema_sql" "$temp_dir/source-schema.json"
run_query "$dest_db" "$schema_sql" "$temp_dir/dest-schema.json"
canonical_results "$temp_dir/source-schema.json" > "$temp_dir/source-schema.canonical"
canonical_results "$temp_dir/dest-schema.json" > "$temp_dir/dest-schema.canonical"
cmp -s "$temp_dir/source-schema.canonical" "$temp_dir/dest-schema.canonical"
schema_objects="$(jq 'length' "$temp_dir/source-schema.canonical")"
schema_sha="$(sha256_file "$temp_dir/source-schema.canonical")"

local_query "$snapshot_db" "PRAGMA quick_check;" "$temp_dir/source-integrity.json"
run_query "$dest_db" "PRAGMA quick_check;" "$temp_dir/dest-integrity.json"
jq -e '[.[].results[] | to_entries[].value] == ["ok"]' "$temp_dir/source-integrity.json" >/dev/null
jq -e '[.[].results[] | to_entries[].value] == ["ok"]' "$temp_dir/dest-integrity.json" >/dev/null

local_query "$snapshot_db" "PRAGMA foreign_key_check;" "$temp_dir/source-fk.json"
run_query "$dest_db" "PRAGMA foreign_key_check;" "$temp_dir/dest-fk.json"
jq -e '[.[].results[]] | length == 0' "$temp_dir/source-fk.json" >/dev/null
jq -e '[.[].results[]] | length == 0' "$temp_dir/dest-fk.json" >/dev/null

echo "[6/8] Reconciling every user-table row count"
local_query "$snapshot_db" "$table_sql" "$temp_dir/tables.json"
jq -r '.[].results[].name' "$temp_dir/tables.json" > "$temp_dir/tables.txt"
table_count="$(wc -l < "$temp_dir/tables.txt" | tr -d ' ')"
test "$table_count" -gt 0

: > "$temp_dir/row-statements.txt"
while IFS= read -r table; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  statement="SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM \"${table}\""
  echo "$statement" >> "$temp_dir/row-statements.txt"
done < "$temp_dir/tables.txt"

batched_query local "$snapshot_db" "$temp_dir/row-statements.txt" "$temp_dir/source-rows.json"
echo "      Source-snapshot row controls calculated"
batched_query remote "$dest_db" "$temp_dir/row-statements.txt" "$temp_dir/dest-rows.json"
echo "      Destination row controls calculated"
canonical_results "$temp_dir/source-rows.json" > "$temp_dir/source-rows.canonical"
canonical_results "$temp_dir/dest-rows.json" > "$temp_dir/dest-rows.canonical"
if ! cmp -s "$temp_dir/source-rows.canonical" "$temp_dir/dest-rows.canonical"; then
  python3 - "$temp_dir/source-rows.canonical" "$temp_dir/dest-rows.canonical" <<'PY'
import json, sys
source={r['table_name']:r['row_count'] for r in json.load(open(sys.argv[1]))}
dest={r['table_name']:r['row_count'] for r in json.load(open(sys.argv[2]))}
names=sorted(k for k in source.keys() | dest.keys() if source.get(k) != dest.get(k))
print('Row-count reconciliation mismatch in tables:', ', '.join(names))
PY
  exit 31
fi
row_sha="$(sha256_file "$temp_dir/source-rows.canonical")"

echo "[7/8] Reconciling numeric financial control totals"
column_sql="SELECT m.name AS table_name, p.name AS column_name, COALESCE(p.type, '') AS column_type FROM sqlite_schema AS m JOIN pragma_table_info(m.name) AS p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' ORDER BY m.name, p.cid;"
local_query "$snapshot_db" "$column_sql" "$temp_dir/columns.json"

: > "$temp_dir/monetary-statements.txt"
monetary_controls=0
while IFS=$'\t' read -r table column column_type; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  [[ "$column" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  lower_column="$(printf '%s' "$column" | tr '[:upper:]' '[:lower:]')"
  lower_type="$(printf '%s' "$column_type" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower_column" =~ (amount|total|balance|fee|cost|budget|pledge|gift|donation|income|expense|tuition|payment|salary|compensation|revenue|principal|interest|allocation|forecast|reserve) ]] &&
     [[ "$lower_type" =~ (int|real|num|dec|double|float) ]]; then
    statement="SELECT '${table}' AS table_name, '${column}' AS column_name, COUNT(\"${column}\") AS populated_rows, printf('%.17g', COALESCE(SUM(CAST(\"${column}\" AS REAL)), 0)) AS control_total FROM \"${table}\""
    echo "$statement" >> "$temp_dir/monetary-statements.txt"
    monetary_controls=$((monetary_controls + 1))
  fi
done < <(jq -r '.[].results[] | [.table_name, .column_name, .column_type] | @tsv' "$temp_dir/columns.json")
test "$monetary_controls" -gt 0

batched_query local "$snapshot_db" "$temp_dir/monetary-statements.txt" "$temp_dir/source-money.json"
batched_query remote "$dest_db" "$temp_dir/monetary-statements.txt" "$temp_dir/dest-money.json"
canonical_results "$temp_dir/source-money.json" > "$temp_dir/source-money.canonical"
canonical_results "$temp_dir/dest-money.json" > "$temp_dir/dest-money.canonical"
cmp -s "$temp_dir/source-money.canonical" "$temp_dir/dest-money.canonical"
monetary_sha="$(sha256_file "$temp_dir/source-money.canonical")"

echo "[8/8] Reconciling AUTOINCREMENT sequence state"
# Not part of the disposable recovery drill (a database deleted minutes later never needs to
# keep accepting new AUTOINCREMENT inserts correctly) but essential here: a mismatch would mean
# the next real INSERT after cutover could reuse an id already used by imported data.
sequence_sql="SELECT name, seq FROM sqlite_sequence ORDER BY name;"
local_query "$snapshot_db" "$sequence_sql" "$temp_dir/source-sequence.json"
run_query "$dest_db" "$sequence_sql" "$temp_dir/dest-sequence.json"
canonical_results "$temp_dir/source-sequence.json" > "$temp_dir/source-sequence.canonical"
canonical_results "$temp_dir/dest-sequence.json" > "$temp_dir/dest-sequence.canonical"
cmp -s "$temp_dir/source-sequence.canonical" "$temp_dir/dest-sequence.canonical"
sequence_entries="$(jq 'length' "$temp_dir/source-sequence.canonical")"
sequence_sha="$(sha256_file "$temp_dir/source-sequence.canonical")"

echo "Done -- source database was not modified; plaintext export removed"
python3 - "$export_file" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
if p.exists(): p.unlink()
PY
test ! -e "$export_file"

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_db "$source_db" \
  --arg source_db_id "$source_db_id" \
  --arg dest_db "$dest_db" \
  --arg dest_db_id "$dest_db_id" \
  --arg export_sha256 "$export_sha" \
  --argjson export_bytes "$export_bytes" \
  --argjson schema_objects "$schema_objects" \
  --arg schema_control_sha256 "$schema_sha" \
  --argjson tables "$table_count" \
  --arg row_control_sha256 "$row_sha" \
  --argjson monetary_controls "$monetary_controls" \
  --arg monetary_control_sha256 "$monetary_sha" \
  --argjson sequence_entries "$sequence_entries" \
  --arg sequence_control_sha256 "$sequence_sha" \
  --argjson rewritten_statements "$rewritten_statements" \
  --argjson rewritten_cells "$rewritten_cells" \
  --argjson max_statement_after "$max_statement_after" \
  --argjson dest_cleared_first "$([[ "$dest_existing_count" -gt 0 ]] && echo true || echo false)" \
  '{completed_at:$completed_at,source_db:$source_db,source_db_id_verified:$source_db_id,dest_db:$dest_db,dest_db_id_verified:$dest_db_id,export_bytes:$export_bytes,export_sha256:$export_sha256,oversized_export_statements_rewritten:$rewritten_statements,large_cells_length_verified:$rewritten_cells,max_import_statement_bytes:$max_statement_after,destination_cleared_before_import:$dest_cleared_first,schema_objects_matched:$schema_objects,schema_control_sha256:$schema_control_sha256,foreign_key_violations:0,integrity_check:"ok",tables_matched:$tables,row_control_sha256:$row_control_sha256,monetary_controls_matched:$monetary_controls,monetary_control_sha256:$monetary_control_sha256,autoincrement_sequences_matched:$sequence_entries,sequence_control_sha256:$sequence_control_sha256,source_database_modified:false,destination_never_bound_to_a_worker:true,sensitive_values_logged:false}' > "$result_file"

cat "$result_file"
