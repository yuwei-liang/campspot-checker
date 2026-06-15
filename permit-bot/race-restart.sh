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

blue "=== 1/7 stopping any running watch-auto (including ghosts) ==="
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
blue "=== 2/7 verifying login state for both accounts (auto-relogin if needed) ==="
# Persistent profile cookies expire. A logged-out warm browser is a silent
# failure — handleLoginModalIfPresent only fires when a modal is OPEN, not
# when the page is anonymous. Gate the whole flow on this BEFORE touching
# cart holds or launching watch-auto.
#
# If a session is dead, the `login` subcommand auto-fills creds from .env
# (REC_EMAIL_N / REC_PASSWORD_N), so we can self-heal without user input —
# UNLESS rec.gov throws a CAPTCHA / 2FA challenge, in which case the user
# must finish in the headed window before the internal 5-min timeout.
LOGIN_FAIL=0
for acct in 1 2; do
    if node permit-bot/permit-bot.mjs check-session --account=$acct > /dev/null 2>&1; then
        green "✓ acct$acct logged in"
        continue
    fi
    red "✗ acct$acct session expired — attempting auto-relogin from .env creds..."
    # `login` opens headed Chromium, auto-fills, waits up to 5 min for the
    # "Sign Up / Log In" button to disappear. If CAPTCHA pops, user solves
    # it in that window; otherwise it's hands-free.
    if node permit-bot/permit-bot.mjs login --account=$acct 2>&1 | tail -5; then
        if node permit-bot/permit-bot.mjs check-session --account=$acct > /dev/null 2>&1; then
            green "✓ acct$acct auto-relogin OK"
        else
            red "✗ acct$acct: login command finished but check-session still fails."
            LOGIN_FAIL=1
        fi
    else
        red "✗ acct$acct: login command failed (CAPTCHA? missing .env creds?)."
        LOGIN_FAIL=1
    fi
done
if [ "$LOGIN_FAIL" = "1" ]; then
    red ""
    red "ABORT: auto-relogin couldn't recover at least one account. Likely a"
    red "CAPTCHA or 2FA challenge on rec.gov side. Run manually:"
    red ""
    red "    node permit-bot/permit-bot.mjs login --account=N"
    red ""
    red "(headed window opens — solve any challenge there). Then re-run this script."
    exit 1
fi

blue ""
blue "=== 3/7 releasing any leftover cart holds (defensive) ==="
node permit-bot/permit-bot.mjs release-cart --accounts=1,2 2>&1 | grep -E "acct[12]:" || true

blue ""
blue "=== 4/7 starting fresh watch-auto --pre-warm ==="
rm -f "$PID_FILE" "$LOG_FILE"
# caffeinate prevents macOS from putting the bot to sleep:
#   -i: prevent idle sleep (system & display)
#   -s: prevent system sleep on AC power
#   -m: prevent disk sleep
# Without this, the bot's Chromium warmers can trigger App Nap and the
# node event loop freezes silently — observed 06-15 race-day: 16 min of
# zero events spanning 06:55–07:11 PT, missed the entire release window.
nohup caffeinate -ism node permit-bot/permit-bot.mjs watch-auto --pre-warm > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
NEW_PID=$(cat "$PID_FILE")
green "✓ launched PID $NEW_PID (wrapped in caffeinate -ism to prevent App Nap)"

blue ""
blue "=== 5/7 waiting for both warmers (15-25s) ==="
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
blue "=== 6/7 verifying poll loop ==="
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
blue "=== 7/7 ready ==="
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
  Stop bot:      pkill -f 'permit-bot.mjs watch-auto'   # kills both caffeinate + node
  Check alive:   pgrep -fl 'permit-bot.mjs watch-auto'  # shows the caffeinate + node pids

EOF
green "good luck 🏕️"
