#!/usr/bin/env bash
set -u
cd /Users/kimgarden/dev/nfc-walk-race
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|PUBLISHABLE_KEY)=')"
DB=postgresql://postgres:postgres@127.0.0.1:55422/postgres
echo "# AC4 anon RLS check  $(date -u +%FT%TZ)  API=$API_URL"
for label in ANON_KEY PUBLISHABLE_KEY; do K=${!label}
 echo "## key: $label (value not recorded)"
 for t in sessions tags teams participants tag_events announcements; do
  echo "GET /rest/v1/$t?select=*  -> $(curl -s -w ' [HTTP %{http_code}]' "$API_URL/rest/v1/$t?select=*" -H "apikey: $K" -H "Authorization: Bearer $K")"
 done
 echo "POST /rest/v1/sessions (insert) -> $(curl -s -w ' [HTTP %{http_code}]' -X POST "$API_URL/rest/v1/sessions" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d '{"id":"HACK","name":"x","code":"HACK01","checkpoint_count":1,"award_ranks":1}')"
 echo "PATCH /rest/v1/sessions (update) -> $(curl -s -w ' [HTTP %{http_code}]' -X PATCH "$API_URL/rest/v1/sessions?id=eq.DEMOSESS" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d '{"status":"live"}')"
 echo "DELETE /rest/v1/tags -> $(curl -s -w ' [HTTP %{http_code}]' -X DELETE "$API_URL/rest/v1/tags?session_id=eq.DEMOSESS" -H "apikey: $K" -H "Authorization: Bearer $K")"
 for fn in \
  'record_tag|{"p_participant_id":"x","p_token":"demo000001","p_uid":null,"p_event_id":"x"}' \
  'get_admin_live_data|{"p_session_id":"DEMOSESS"}' \
  'get_team_race_data|{"p_participant_id":"x"}' \
  'create_team|{"p_participant_id":"x","p_team_id":"x","p_name":"x","p_join_code":"XXXX"}' \
  'join_team|{"p_participant_id":"x","p_join_code":"XXXX"}' \
  'create_announcement|{"p_session_id":"DEMOSESS","p_id":"x","p_message":"x"}' \
  'create_tag|{"p_session_id":"DEMOSESS","p_id":"x","p_token":"x","p_uid":"","p_name":"x","p_position":null,"p_hint":"","p_next_hint":"","p_location_note":""}' \
  'required_checkpoints|{"p_session_id":"DEMOSESS"}'; do
  n=${fn%%|*}; b=${fn#*|}
  echo "POST /rest/v1/rpc/$n -> $(curl -s -w ' [HTTP %{http_code}]' -X POST "$API_URL/rest/v1/rpc/$n" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d "$b")"
 done
done
echo "## DB state after attempts (psql as postgres): expect sessions=1 status=ready, tags=4, announcements=0"
psql "$DB" -Atc "select 'sessions', count(*), string_agg(status, ',') from sessions union all select 'tags', count(*), '' from tags union all select 'announcements', count(*), '' from announcements;"
echo "## RLS flags and policy count"
psql "$DB" -Atc "select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1;"
psql "$DB" -Atc "select 'policies_in_public', count(*) from pg_policies where schemaname='public';"
echo "## anon/authenticated table privileges in public (expect none)"
psql "$DB" -Atc "select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated');"
echo "## function EXECUTE for anon (expect all f)"
psql "$DB" -Atc "select p.proname, has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace='public'::regnamespace order by 1;"
