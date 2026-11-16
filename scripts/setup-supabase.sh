#!/usr/bin/env bash
# Sets up a fresh Supabase project for "Bucket List" through the Supabase Management API.
#   SUPABASE_ACCESS_TOKEN=sbp_… ./scripts/setup-supabase.sh <project-ref>
# Does: login without e-mail confirmation, database schema (all migrations),
# server functions, a secret for scheduled notifications, and the schedule
# itself (pg_cron, every 15 minutes). The Claude key (ANTHROPIC_API_KEY) is
# added separately in the Supabase dashboard (Edge Functions → Secrets).
set -euo pipefail

REF="${1:?Projekt-ID fehlt}"
API="https://api.supabase.com/v1/projects/$REF"
AUTH=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN fehlt}")
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SUPABASE_BIN="${SUPABASE_BIN:-npx --yes supabase}"

api() { # method path [json-body]
  local out code
  out="$(mktemp)"
  code=$(curl -sS -o "$out" -w "%{http_code}" -X "$1" "${AUTH[@]}" -H "Content-Type: application/json" "$API$2" ${3:+--data-binary "$3"})
  if [ "${code:0:1}" != "2" ]; then echo "Fehler $code bei $1 $2: $(head -c 400 "$out")" >&2; rm -f "$out"; return 1; fi
  cat "$out"; rm -f "$out"
}

sql() { # runs SQL as the database owner
  local body
  body=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')
  api POST /database/query "$body" >/dev/null
}

echo "1/5 Login ohne E-Mail-Bestätigung"
api PATCH /config/auth '{"mailer_autoconfirm": true, "external_email_enabled": true}' >/dev/null

echo "2/5 Datenbank-Schema"
sql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
for f in "$HERE"/supabase/migrations/*.sql; do
  name="$(basename "$f" .sql)"; version="${name%%_*}"
  applied=$(api POST /database/query "$(python3 -c 'import json,sys; print(json.dumps({"query": "select count(*) as n from supabase_migrations.schema_migrations where version = '"'"'"+sys.argv[1]+"'"'"'"}))' "$version")" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["n"])')
  if [ "$applied" != "0" ]; then echo "   – $name (schon da)"; continue; fi
  sql < "$f"
  printf "insert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');" "$version" "${name#*_}" | sql
  echo "   ✓ $name"
done

echo "3/5 Geheimnis für die Benachrichtigungen"
secrets=$(api GET /secrets)
if ! echo "$secrets" | grep -q '"PUSH_CRON_SECRET"'; then
  CRON_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  api POST /secrets "[{\"name\":\"PUSH_CRON_SECRET\",\"value\":\"$CRON_SECRET\"}]" >/dev/null
else
  CRON_SECRET=""
  echo "   – schon vorhanden"
fi

echo "4/5 Server-Funktionen"
cd "$HERE"
for fn in coach account calendar push voice; do
  $SUPABASE_BIN functions deploy "$fn" --project-ref "$REF" --use-api --no-verify-jwt --yes >/dev/null
  echo "   ✓ $fn"
done

echo "5/5 Zeitplan: Morgen- und Abendnachricht (alle 15 Minuten)"
# The job keeps its old name 'i-am-push' (from when the app was called "I am"): the Nolio and WHOOP
# migrations look it up by that name.
if [ -n "$CRON_SECRET" ]; then
  sql <<SQL
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('i-am-push') where exists (select 1 from cron.job where jobname = 'i-am-push');
select cron.schedule(
  'i-am-push',
  '*/15 * * * *',
  \$\$ select net.http_post(
       url := 'https://$REF.supabase.co/functions/v1/push',
       headers := '{"Content-Type": "application/json", "x-cron-secret": "$CRON_SECRET"}'::jsonb,
       body := '{"action": "dispatch"}'::jsonb
     ) \$\$
);
SQL
  echo "   ✓ eingerichtet"
else
  echo "   – unverändert (Geheimnis existierte schon)"
fi

echo "Fertig. Fehlt nur noch: ANTHROPIC_API_KEY unter https://supabase.com/dashboard/project/$REF/functions/secrets"
