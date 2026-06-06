#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-25564}"

# WebRTC TURN defaults for the local coturn setup.
# Override TURN_HOST, TURN_REALM, and TURN_SECRET in your shell/service config.
export TURN_HOST="${TURN_HOST:-[IP/DOMAIN]}"
export TURN_ALT_HOSTS="${TURN_ALT_HOSTS:-}"
export TURN_REALM="${TURN_REALM:-$TURN_HOST}"
export TURN_PORT="${TURN_PORT:-25510}"
export TURN_TLS_PORT="${TURN_TLS_PORT:-25511}"
export TURN_RELAY_MIN_PORT="${TURN_RELAY_MIN_PORT:-30000}"
export TURN_RELAY_MAX_PORT="${TURN_RELAY_MAX_PORT:-30030}"
export TURN_TTL_SECONDS="${TURN_TTL_SECONDS:-3600}"
export TURN_RELAY_ONLY="${TURN_RELAY_ONLY:-true}"
export TURN_ENABLE_STUN="${TURN_ENABLE_STUN:-false}"
export TURN_ENABLE_TCP="${TURN_ENABLE_TCP:-true}"
export TURN_SECRET="${TURN_SECRET:}"
if [[ -z "${TURN_SECRET:-}" ]]; then
  echo "WARNING: TURN_SECRET is not set; /turn-credentials will fall back to static demo credentials."
  echo "Set TURN_SECRET to the same value as static-auth-secret in turnserver.conf."
fi

echo "Starting SSC..."
echo "App: https://${TURN_HOST}:${PORT}"
echo "TURN: ${TURN_HOST}:${TURN_PORT}, alternates ${TURN_ALT_HOSTS:-none}, relay ports ${TURN_RELAY_MIN_PORT}-${TURN_RELAY_MAX_PORT}"
echo "TURN modes: relay-only=${TURN_RELAY_ONLY}, stun=${TURN_ENABLE_STUN}, tcp=${TURN_ENABLE_TCP}"
node server.js
