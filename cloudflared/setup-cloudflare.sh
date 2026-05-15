#!/usr/bin/env bash
# Provisions everything on the Cloudflare side for campspot.yuweiliang.com:
#   1. Named tunnel (config_src=cloudflare, so ingress is managed via API)
#   2. Ingress: campspot.yuweiliang.com -> http://host.docker.internal:49160
#   3. DNS CNAME -> <tunnel-id>.cfargotunnel.com (proxied)
#   4. Zero Trust Access application
#   5. Access policy allowing the listed emails (one-time PIN auth)
# Writes the resulting TUNNEL_TOKEN into ./.env so the docker-compose can pick it up.
#
# Required env:
#   CLOUDFLARE_API_TOKEN  custom token with these scopes:
#                           Account > Cloudflare Tunnel: Edit
#                           Account > Access: Apps and Policies: Edit
#                           Zone    > DNS: Edit
#                           Zone    > Zone: Read
#                         Restrict zone scope to yuweiliang.com.
#   ALLOWED_EMAILS        comma-separated list, e.g. "you@x.com,friend@y.com"
#
# Optional env:
#   DOMAIN=yuweiliang.com  SUBDOMAIN=campspot  TUNNEL_NAME=campspot
#   SERVICE_URL=http://host.docker.internal:49160
#   ACCESS_APP_NAME="Campspot Checker"

set -euo pipefail

DOMAIN="${DOMAIN:-yuweiliang.com}"
SUBDOMAIN="${SUBDOMAIN:-campspot}"
TUNNEL_NAME="${TUNNEL_NAME:-campspot}"
SERVICE_URL="${SERVICE_URL:-http://host.docker.internal:49160}"
ACCESS_APP_NAME="${ACCESS_APP_NAME:-Campspot Checker}"
HOSTNAME="$SUBDOMAIN.$DOMAIN"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (see header for required scopes)}"
: "${ALLOWED_EMAILS:?Set ALLOWED_EMAILS, comma-separated}"

command -v jq >/dev/null || { echo "jq required: brew install jq" >&2; exit 1; }

API=https://api.cloudflare.com/client/v4
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cf() {
  local method=$1 path=$2 body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  fi
}

# Treat "already exists / duplicate" as success, abort otherwise.
ok_or_existing() {
  local resp=$1 what=$2
  local ok; ok=$(jq -r '.success' <<<"$resp")
  if [[ "$ok" == "true" ]]; then return 0; fi
  if jq -r '.errors[]?.message' <<<"$resp" | grep -qiE 'already|exists|duplicate|conflict'; then
    return 1
  fi
  echo "FAILED: $what" >&2
  jq . <<<"$resp" >&2
  exit 1
}

require_success() {
  local resp=$1 what=$2
  [[ "$(jq -r '.success' <<<"$resp")" == "true" ]] && return 0
  echo "FAILED: $what" >&2
  jq . <<<"$resp" >&2
  exit 1
}

echo "==> Verifying API token"
require_success "$(cf GET /user/tokens/verify)" "verify token"

echo "==> Looking up zone $DOMAIN"
resp=$(cf GET "/zones?name=$DOMAIN")
require_success "$resp" "list zones"
ZONE_ID=$(jq -r '.result[0].id // empty' <<<"$resp")
ACCOUNT_ID=$(jq -r '.result[0].account.id // empty' <<<"$resp")
[[ -n "$ZONE_ID" && -n "$ACCOUNT_ID" ]] || { echo "Zone $DOMAIN not visible to this token" >&2; exit 1; }
echo "    zone=$ZONE_ID account=$ACCOUNT_ID"

echo "==> Creating tunnel '$TUNNEL_NAME'"
resp=$(cf POST "/accounts/$ACCOUNT_ID/cfd_tunnel" \
  "$(jq -n --arg n "$TUNNEL_NAME" '{name:$n, config_src:"cloudflare"}')")
if ok_or_existing "$resp" "create tunnel"; then
  TUNNEL_ID=$(jq -r '.result.id' <<<"$resp")
else
  resp=$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false")
  require_success "$resp" "list tunnels"
  TUNNEL_ID=$(jq -r '.result[0].id' <<<"$resp")
fi
echo "    tunnel=$TUNNEL_ID"

echo "==> Fetching tunnel token"
resp=$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token")
require_success "$resp" "fetch tunnel token"
TUNNEL_TOKEN=$(jq -r '.result' <<<"$resp")

echo "==> Setting ingress: $HOSTNAME -> $SERVICE_URL"
resp=$(cf PUT "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  "$(jq -n --arg host "$HOSTNAME" --arg svc "$SERVICE_URL" \
    '{config: {ingress: [{hostname:$host, service:$svc}, {service:"http_status:404"}]}}')")
require_success "$resp" "set ingress"

echo "==> Upserting DNS CNAME $HOSTNAME -> $TUNNEL_ID.cfargotunnel.com"
resp=$(cf POST "/zones/$ZONE_ID/dns_records" \
  "$(jq -n --arg n "$SUBDOMAIN" --arg c "$TUNNEL_ID.cfargotunnel.com" \
    '{type:"CNAME", name:$n, content:$c, proxied:true}')")
ok_or_existing "$resp" "create DNS record" || echo "    (already exists, leaving as-is)"

echo "==> Creating Access application for $HOSTNAME"
resp=$(cf POST "/accounts/$ACCOUNT_ID/access/apps" \
  "$(jq -n --arg n "$ACCESS_APP_NAME" --arg d "$HOSTNAME" \
    '{name:$n, domain:$d, type:"self_hosted", session_duration:"24h"}')")
if ok_or_existing "$resp" "create access app"; then
  APP_ID=$(jq -r '.result.id' <<<"$resp")
else
  resp=$(cf GET "/accounts/$ACCOUNT_ID/access/apps")
  require_success "$resp" "list access apps"
  APP_ID=$(jq -r --arg d "$HOSTNAME" '.result[] | select(.domain==$d) | .id' <<<"$resp" | head -1)
fi
echo "    app=$APP_ID"

echo "==> Creating Access policy (allow listed emails)"
emails_json=$(tr ',' '\n' <<<"$ALLOWED_EMAILS" \
  | sed 's/^ *//;s/ *$//' \
  | jq -R 'select(length>0) | {email:{email:.}}' \
  | jq -s .)
resp=$(cf POST "/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" \
  "$(jq -n --argjson inc "$emails_json" '{name:"Allow friends", decision:"allow", include:$inc}')")
ok_or_existing "$resp" "create access policy" || echo "    (already exists, leaving as-is)"

echo "==> Writing tunnel token to $script_dir/.env"
umask 077
printf 'TUNNEL_TOKEN=%s\n' "$TUNNEL_TOKEN" > "$script_dir/.env"

echo
echo "Done. Tunnel + DNS + Access are live."
echo "Next: upload $script_dir/docker-compose.yml and $script_dir/.env"
echo "      to Synology Container Manager as a new project."
