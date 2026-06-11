#!/bin/bash
# Race-day restart: fresh watch-auto + fresh warmers before 7am PT.
#
# Usage: bash permit-bot/race-restart.sh
#
# What this does:
#   1. Stops any running watch-auto (handles ghost processes properly)
#   2. Closes leftover Chromium windows from prior runs
#   3. Releases any cart holds on both accounts (safety)
#   4. Starts fresh watch-auto --pre-warm in the background
#   5. Waits for both warmers to come up
#   6. Confirms healthy state + prints next-action steps
#
# Run this 5-10 minutes BEFORE the 7am PT release moment (e.g. at 6:55am).
# Then sit back, watch Discord, and finish the wizard if it grabs.

set -e
cd "$(dirname "$0")/.."

PID_FILE=/tmp/permit-bot.pid
LOG_FILE=/tmp/permit-bot.log

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[34m%s\033[0m\n" "$*"; }

blue "=== 1/6 stopping any running watch-auto (including ghosts) ==="
# pkill returns non-zero if no match; that's fine — we ignore it via the `|| true`.
pkill -f "permit-bot.mjs watch-auto" 2>/dev/null || true
sleep 2

# Hard-kill any straggler Chromium still holding the profile dirs.
ps aux | grep -E "Chrome for Testing.*permit-bot/\.chromium-profile" | grep -v grep \
    | awk '{print $2}' | xargs -r kill 2>/dev/null || true
sleep 2

remaining=$(ps -e -o pid,command | grep "permit-bot.mjs watch-auto" | grep -v grep | wc -l | tr -d ' ')
if [ "$remaining" != "0" ]; then
    red "WARNING: $remaining watch-auto process(es) still running. Trying SIGKILL..."
    pkill -9 -f "permit-bot.mjs watch-auto" 2>/dev/null || true
    sleep 2
fi
green "✓ clean state"

blue ""
blue "=== 2/6 releasing any leftover cart holds (defensive) ==="
node permit-bot/permit-bot.mjs release-cart --accounts=1,2 2>&1 | grep -E "acct[12]:" || true

blue ""
blue "=== 3/6 starting fresh watch-auto --pre-warm ==="
rm -f "$PID_FILE" "$LOG_FILE"
nohup node permit-bot/permit-bot.mjs watch-auto --pre-warm > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
NEW_PID=$(cat "$PID_FILE")
green "✓ launched PID $NEW_PID"

blue ""
blue "=== 4/6 waiting for both warmers (15-25s) ==="
# Wait up to 35s for "Pre-warm complete; N/2 warmers idling."
deadline=$((SECONDS + 35))
while [ $SECONDS -lt $deadline ]; do
    if grep -q "Pre-warm complete" "$LOG_FILE" 2>/dev/null; then break; fi
    sleep 1
done

if grep -q "Pre-warm complete" "$LOG_FILE"; then
    grep "Pre-warm complete" "$LOG_FILE" | tail -1
    green "✓ warmers idling"
else
    red "WARNING: didn't see 'Pre-warm complete' in 35s. Check $LOG_FILE."
fi

blue ""
blue "=== 5/6 verifying poll loop ==="
sleep 4
POLLS=$(grep -c "poll [0-9]* ok" "$LOG_FILE" || echo 0)
LATEST=$(tail -1 "$LOG_FILE")
echo "polls so far: $POLLS"
echo "latest log:   $LATEST"

ALIVE=$(kill -0 "$NEW_PID" 2>/dev/null && echo YES || echo NO)
[ "$ALIVE" = "YES" ] && green "✓ PID $NEW_PID alive" || red "✗ PID $NEW_PID DEAD"

PROC_COUNT=$(ps -e -o pid,command | grep "permit-bot.mjs watch-auto" | grep -v grep | wc -l | tr -d ' ')
if [ "$PROC_COUNT" = "1" ]; then
    green "✓ exactly 1 watch-auto process (no ghosts)"
else
    red "WARNING: $PROC_COUNT watch-auto processes. Expected 1."
fi

blue ""
blue "=== 6/6 ready ==="
SESSION_LOG=$(grep "Session log:" "$LOG_FILE" | head -1 | awk -F': ' '{print $NF}')
cat <<EOF

  📋 Status summary
  ─────────────────
  Watch-auto PID:  $NEW_PID
  Stdout log:      $LOG_FILE
  Session log:     $SESSION_LOG
  Polls counted:   $POLLS

  ⏰ Next steps
  ────────────
  • 7:00am PT (14:00 UTC): rec.gov releases the slots. Bot fires automatically.
  • Watch Discord for cart-hold confirmation (with screenshot).
  • Open https://www.recreation.gov/cart and complete the wizard within 15 min.

  🛠 Useful commands
  ──────────────────
  Tail logs:     tail -f $LOG_FILE
  Stop bot:      kill \$(cat $PID_FILE)
  Check alive:   kill -0 \$(cat $PID_FILE) && echo ALIVE || echo DEAD

EOF
green "good luck 🏕️"
