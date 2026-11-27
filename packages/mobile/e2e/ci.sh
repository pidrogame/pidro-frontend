#!/usr/bin/env bash
# The account journeys as CI runs them (account-e2e.yml): the backend, the old web client and
# Expo web. E2E_SHARD (current/total) runs one shard of them. The backend never puts reset tokens
# in its answer (PASSWORD_RESET_DEBUG_TOKENS=false).
# Expects the backend checked out and compiled in $BACKEND_DIR, and Postgres up.
set -euo pipefail
cd "$(dirname "$0")/.."
backend=${BACKEND_DIR:-../../backend}
shard=${E2E_SHARD:-}
if [ -n "$shard" ] && { [[ ! "$shard" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] ||
  [ "${BASH_REMATCH[1]}" -gt "${BASH_REMATCH[2]}" ]; }; then
  echo "E2E_SHARD must be current/total with 1 <= current <= total" >&2
  exit 1
fi
backend_pid=

start_backend() {
  (
    cd "$backend" || exit 1
    exec env PORT=4000 \
      LIFECYCLE_TURN_TIMER_BID_MS=1200 LIFECYCLE_TURN_TIMER_PLAY_MS=900 \
      LIFECYCLE_CONNECTION_CHECK_INTERVAL_MS=1000 LIFECYCLE_TURN_PAUSE_BUDGET_MS=1000 \
      LIFECYCLE_BOT_DELAY_MS=60 LIFECYCLE_BOT_DELAY_VARIANCE_MS=40 \
      LIFECYCLE_BOT_MIN_DELAY_MS=20 LIFECYCLE_TRICK_TRANSITION_DELAY_MS=80 \
      LIFECYCLE_HAND_TRANSITION_DELAY_MS=120 LIFECYCLE_SECOND_DEAL_TRANSITION_DELAY_MS=120 \
      LIFECYCLE_DEAL_TRANSITION_DELAY_MS=120 \
      APPLE_JWKS_URL=http://127.0.0.1:4002/apple/auth/keys APPLE_AUDIENCE=com.pidro.e2e \
      FACEBOOK_JWKS_URL=http://127.0.0.1:4002/facebook/jwks \
      FACEBOOK_GRAPH_URL=http://127.0.0.1:4002/graph FACEBOOK_APP_ID=1234567890 \
      PASSWORD_RESET_DEBUG_TOKENS=false \
      "$@" mix phx.server
  ) >> /tmp/pidro-backend.log 2>&1 &
  backend_pid=$!
  for _ in $(seq 1 90); do
    curl -s -o /dev/null http://127.0.0.1:4000/api/v1/rooms && return 0
    sleep 2
  done
  echo "backend never became ready"
  cat /tmp/pidro-backend.log
  exit 1
}

wait_for() {
  for _ in $(seq 1 "$2"); do
    curl --fail --silent "$1" >/dev/null && return 0
    sleep 1
  done
  echo "$1 never answered"
  cat "$3"
  exit 1
}

# The reset email links to the old web client; the journeys follow that link.
(cd ../web && NODE_OPTIONS= VITE_API_URL=http://127.0.0.1:4000 VITE_WS_URL=ws://127.0.0.1:4000/socket \
  bun run dev --host 127.0.0.1 --port 5173 > /tmp/pidro-web.log 2>&1) &
# The only place the flag is set: the Apple and Facebook buttons appear on web and take their
# answer from the journey.
EXPO_PUBLIC_E2E=1 bunx expo start --web --port 8081 > /tmp/pidro-expo.log 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

start_backend
wait_for http://127.0.0.1:5173/ 30 /tmp/pidro-web.log
wait_for http://127.0.0.1:8081/home 60 /tmp/pidro-expo.log

# Build the bundle now, so the first journey does not wait for Metro.
bundle=$(curl --silent http://127.0.0.1:8081/home | grep -o 'src="[^"]*\.bundle[^"]*"' | head -1 | cut -d'"' -f2 | sed 's/&amp;/\&/g')
curl --fail --silent --output /dev/null "http://127.0.0.1:8081$bundle"

status=0
bun run e2e:accounts ${shard:+--shard "$shard"} || status=$?

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo '### Account journeys'
    echo
    echo "Shard: ${shard:-all}"
    echo
    # Every integration job in a workflow receives the same resolved backend SHA.
    git -C "$backend" log -1 --format='Backend: [%h](https://github.com/marcelfahle/pidro-backend/commit/%H) %s (%cd)' --date=iso
    echo
    echo '| Journey | Result |'
    echo '| --- | --- |'
    jq -r '.. | .specs? // empty | .[] | .title as $title | .tests[] | "| \($title)\(if .projectName == "phone" then "" else " (\(.projectName))" end) | \({expected: "passed", unexpected: "FAILED", flaky: "passed on retry", skipped: "skipped"}[.status] // .status) |"' e2e/journeys.json
  } >> "$GITHUB_STEP_SUMMARY"
  # A journey that needed its retry leaves the job green; flag it on the run itself.
  jq -r '.. | .specs? // empty | .[] | .title as $title | .tests[] | select(.status == "flaky") | "::warning title=Account journey passed on retry::\($title) (\(.projectName))"' e2e/journeys.json
fi

exit "$status"
