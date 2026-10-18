#!/usr/bin/env bash
# Run read-only SQL against the sheriff-sale Postgres database.
#
# Usage: query.sh --env local|prod [--json] <sql>
#        query.sh --env local|prod [--json] < file.sql
#
#   local  The docker-compose container (sheriff-sale-postgres). Uses LOCAL_DATABASE_URL if
#          set, otherwise builds the URL from POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT
#          and POSTGRES_DB in the repo-root .env (defaults: postgres, -, 5432, postgres).
#   prod   The Railway database at PROD_DATABASE_URL (set it in mise.local.toml).
#
# Every session starts read-only (default_transaction_read_only) and the SQL runs in a
# single READ ONLY transaction, so writes fail. This guards against mistakes; it is not
# a security boundary.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

usage() {
  sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

env_name=""
json=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) env_name="${2:-}"; shift 2 ;;
    --env=*) env_name="${1#--env=}"; shift ;;
    --json) json=true; shift ;;
    -h|--help) usage ;;
    --) shift; break ;;
    -*) echo "Unknown flag: $1" >&2; usage ;;
    *) break ;;
  esac
done

sql="${*:-}"
if [[ -z "$sql" && ! -t 0 ]]; then
  sql="$(cat)"
fi
[[ -n "$sql" ]] || { echo "No SQL given." >&2; usage; }

read_dotenv() {
  local key="$1" file="$repo_root/.env"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//'
}

case "$env_name" in
  local)
    url="${LOCAL_DATABASE_URL:-}"
    if [[ -z "$url" ]]; then
      password="$(read_dotenv POSTGRES_PASSWORD)"
      [[ -n "$password" ]] || { echo "POSTGRES_PASSWORD not found in $repo_root/.env; set LOCAL_DATABASE_URL instead." >&2; exit 1; }
      user="$(read_dotenv POSTGRES_USER)"
      port="$(read_dotenv POSTGRES_PORT)"
      db="$(read_dotenv POSTGRES_DB)"
      url="postgresql://${user:-postgres}:${password}@localhost:${port:-5432}/${db:-postgres}"
    fi
    ;;
  prod)
    url="${PROD_DATABASE_URL:-}"
    # Shells that started before mise.local.toml changed won't have it; ask mise directly.
    if [[ -z "$url" ]] && command -v mise >/dev/null; then
      url="$(cd "$repo_root" && mise exec -- printenv PROD_DATABASE_URL 2>/dev/null || true)"
    fi
    [[ -n "$url" ]] || { echo "PROD_DATABASE_URL is not set. Add the Railway DATABASE_URL to mise.local.toml under [env]." >&2; exit 1; }
    ;;
  "") echo "Missing --env local|prod." >&2; usage ;;
  *) echo "Unknown env '$env_name' (expected local or prod)." >&2; exit 2 ;;
esac

if $json; then
  # Wrap the statement so psql prints one JSON array of row objects.
  sql="SELECT coalesce(json_agg(t), '[]'::json) FROM (${sql%;}) t"
  format=(-A -t)
else
  format=(-P pager=off -P null='∅')
fi

PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30s" \
PGCONNECT_TIMEOUT=10 \
  psql "$url" -X -q -v ON_ERROR_STOP=1 "${format[@]}" \
    -c "BEGIN TRANSACTION READ ONLY" -c "$sql" -c "ROLLBACK"
