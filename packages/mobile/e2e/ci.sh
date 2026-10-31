#!/usr/bin/env bash
# The account journeys as CI runs them (frontend-ci.yml, account-e2e-weekly.yml): the backend, the
# old web client and Expo web. CI selects journeys or expiry; local runs default to both.
# E2E_SPECS (space-separated spec paths) runs only those journeys, on the phone, unsharded.
# Expiry uses lifetimes of a second for journeys tagged @second-run. The backend never puts reset
# tokens in its answer (PASSWORD_RESET_DEBUG_TOKENS=false).
# Expects the backend checked out and compiled in $BACKEND_DIR, and Postgres up.
set -euo pipefail
cd "$(dirname "$0")/.."
backend=${BACKEND_DIR:-../../backend}
suite=${E2E_SUITE:-all}
shard=${E2E_SHARD:-}
specs=${E2E_SPECS:-}
case "$suite" in
  all|journeys|expiry) ;;
  *) echo "E2E_SUITE must be all, journeys or expiry" >&2; exit 1 ;;
esac
if [ -n "$shard" ]; then
  if [ "$suite" != journeys ] || [[ ! "$shard" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] ||
    [ "${BASH_REMATCH[1]}" -gt "${BASH_REMATCH[2]}" ]; then
    echo "E2E_SHARD must be current/total with 1 <= current <= total, for journeys only" >&2
    exit 1
  fi
fi
if [ -n "$specs" ] && { [ "$suite" != journeys ] || [ -n "$shard" ]; }; then
  echo "E2E_SPECS needs E2E_SUITE=journeys and no E2E_SHARD" >&2
  exit 1
fi
backend_pid=

start_backend() {
  (
    cd "$backend" || exit 1
    exec env PORT=4000 \
      LIFECYCLE_TURN_TIMER_BID_MS=1200 LIFECYCLE_TURN_TIMER_PLAY_MS=900 \
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

stop_backend() {
  if [ -n "$backend_pid" ]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
    backend_pid=
  fi
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
trap 'stop_backend; kill $(jobs -p) 2>/dev/null || true' EXIT

if [ "$suite" = expiry ]; then
  start_backend CLASSIC_CLAIM_TICKET_TTL_SECONDS=1 PASSWORD_RESET_TTL_SECONDS=1
else
  start_backend
fi
wait_for http://127.0.0.1:5173/ 30 /tmp/pidro-web.log
wait_for http://127.0.0.1:8081/home 60 /tmp/pidro-expo.log

# Build the bundle now, so the first journey does not wait for Metro.
bundle=$(curl --silent http://127.0.0.1:8081/home | grep -o 'src="[^"]*\.bundle[^"]*"' | head -1 | cut -d'"' -f2 | sed 's/&amp;/\&/g')
curl --fail --silent --output /dev/null "http://127.0.0.1:8081$bundle"

first=0
second=0
if [ "$suite" != expiry ]; then
  if [ -n "$shard" ]; then
    bun run e2e:accounts --shard "$shard" || first=$?
  elif [ -n "$specs" ]; then
    # A table push: the flows through the table, on the phone; UI grammar checks its layouts.
    # shellcheck disable=SC2086 # one argument per spec
    bun run e2e:accounts --project=phone $specs || first=$?
  else
    bun run e2e:accounts || first=$?
  fi
fi

if [ "$suite" = all ]; then
  stop_backend
  start_backend CLASSIC_CLAIM_TICKET_TTL_SECONDS=1 PASSWORD_RESET_TTL_SECONDS=1
fi
if [ "$suite" != journeys ]; then
  bun run e2e:accounts:second-run || second=$?
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo '### Account journeys'
    echo
    echo "Suite: $suite${shard:+ ($shard)}${specs:+ (only the journeys that play through the table)}"
    echo
    # Every integration job in a workflow receives the same resolved backend SHA.
    git -C "$backend" log -1 --format='Backend: [%h](https://github.com/marcelfahle/pidro-backend/commit/%H) %s (%cd)' --date=iso
    echo
    echo '| Journey | Result |'
    echo '| --- | --- |'
    for report in e2e/journeys*.json; do
      [ -f "$report" ] && jq -r '.. | .specs? // empty | .[] | .title as $title | .tests[] | "| \($title)\(if .projectName == "phone" then "" else " (\(.projectName))" end) | \({expected: "passed", unexpected: "FAILED", flaky: "passed on retry", skipped: "skipped"}[.status] // .status) |"' "$report"
    done
  } >> "$GITHUB_STEP_SUMMARY"
  # A journey that needed its retry leaves the job green; flag it on the run itself.
  for report in e2e/journeys*.json; do
    [ -f "$report" ] && jq -r '.. | .specs? // empty | .[] | .title as $title | .tests[] | select(.status == "flaky") | "::warning title=Account journey passed on retry::\($title) (\(.projectName))"' "$report"
  done
fi

[ "$first" -eq 0 ] && [ "$second" -eq 0 ]
