#!/usr/bin/env sh

# Run a command under a wall-clock budget that reports as a FAILURE.
#
# GitHub enforces `timeout-minutes` by CANCELLING the job, so a job killed for
# running too long carries `conclusion: cancelled` — not `failure`. Nothing
# reads a cancellation as a verdict: branch protection ignores it, the checks
# rollup shows no red, and a reviewer sees a leg that looks like somebody pressed
# the
# button. The coverage is gone and the signal that it is gone is gone with it.
#
# That is not hypothetical here. The MySQL integration leg hit its 25-minute
# ceiling and stopped reporting for six consecutive pull requests before anyone
# noticed (integration.yml documents that round). It then hit the 45-minute
# ceiling the same way on three separate branches in one day.
#
# So the budget lives HERE instead, one level below the job's. `timeout` exits
# 124 when it fires, the step exits non-zero, and the job fails — which is
# ordinary, bedrock CI behaviour rather than a property of how GitHub reports
# any particular kind of kill. The job's own `timeout-minutes` stays on as a
# backstop for a hang OUTSIDE this command, and is set high enough that this
# bound always fires first.
#
# Usage: run-with-budget.sh <budget> <what> <command> [args...]
#   budget   a whole number of seconds, minutes or hours: 3300, 55m, 1h
#   what     what to name in the error, e.g. "the MySQL integration suite"
#
# The budget grammar is DELIBERATELY narrower than GNU `timeout`'s, which also
# takes fractions and a `d` suffix. This script has to convert the budget to
# seconds to judge the outcome, and every form it accepts is one it has to
# parse — so the contract is the set it parses, stated here, rather than a
# broader one the parser silently fails on. A CI budget written as `0.5h` or
# `1d` is refused with a message naming the value, not run under a bound
# nobody checked.

set -e

if [ "$#" -lt 3 ]; then
  echo "run-with-budget.sh: usage: <budget> <what> <command> [args...]" >&2
  exit 2
fi

budget="$1"
what="$2"
shift 2

# How long TERM is given before KILL. Named rather than inline because the job's
# own ceiling has to sit above the budget PLUS this, or the job is cancelled
# while the escalation is still running and the failure reverts to the
# cancellation this script exists to replace.
KILL_AFTER=2m

# Refuse rather than run unbounded.
#
# Degrading to an unbounded run when `timeout` is missing would restore exactly
# the state this script exists to remove, and would do it silently — the run
# would look bounded and be a no-op guard. CI is `ubuntu-latest`, where GNU
# coreutils is always present, so this only fires for someone invoking the
# script by hand on a machine without it.
if ! command -v timeout > /dev/null 2>&1; then
  echo "run-with-budget.sh: no \`timeout\` on PATH, refusing to run unbounded." >&2
  echo "  On macOS: brew install coreutils, then expose it as \`timeout\`." >&2
  exit 2
fi

# Seconds, so the elapsed time below can be compared against it.
#
# Refused rather than defaulted when it cannot be read. A budget this script
# cannot parse is one it cannot check the outcome against, and carrying on would
# run the command under a bound nobody can verify — which looks exactly like a
# bounded run.
budget_seconds=$(printf '%s' "$budget" | awk '
  /^[0-9]+$/            { print $0;        exit }
  /^[0-9]+s$/           { print $0 + 0;    exit }
  /^[0-9]+m$/           { print $0 * 60;   exit }
  /^[0-9]+h$/           { print $0 * 3600; exit }
                        { print "";        exit }')

if [ -z "$budget_seconds" ]; then
  echo "run-with-budget.sh: cannot read '${budget}' as a duration, refusing." >&2
  exit 2
fi

# GNU `timeout` documents a duration of 0 as DISABLING the timeout, so a budget
# of `0m` would run the command unbounded while every visible sign — the wrapper
# in the workflow, the budget in the env — says it is bounded. That is the
# failure this script exists to remove, wearing the costume of the fix.
if [ "$budget_seconds" -le 0 ]; then
  echo "run-with-budget.sh: a budget of '${budget}' disables the timeout, refusing." >&2
  exit 2
fi

# `--kill-after` because TERM is a request. A vitest worker wedged on a database
# socket can ignore it, and a budget that a hung process can decline to honour
# is not a budget.
started=$(date +%s)
set +e
timeout --kill-after="$KILL_AFTER" "$budget" "$@"
status=$?
set -e
elapsed=$(( $(date +%s) - started ))

# 124 is `timeout`'s own "the command timed out", and nothing else produces it.
if [ "$status" -eq 124 ]; then
  budget_exceeded=yes
# 137 is 128+SIGKILL, which the `--kill-after` escalation produces when TERM was
# ignored — and which the runner's OOM killer produces too, on a command that
# died in its first minute. The exit code cannot tell those apart, so the
# ELAPSED time does: a budget that never came close to expiring did not expire.
# Reporting an out-of-memory kill as an overrun would send the next person to
# raise a budget that was never the problem.
elif [ "$status" -eq 137 ] && [ "$elapsed" -ge "$budget_seconds" ]; then
  budget_exceeded=yes
else
  budget_exceeded=no
fi

if [ "$budget_exceeded" = yes ]; then
  echo "::error title=Integration budget exceeded::${what} ran past its ${budget} budget and was stopped after ${elapsed}s. This is reported as a FAILURE on purpose: a job-level timeout would have been recorded as a cancellation, which no gate reads. Either the suite has genuinely outgrown the budget (raise it in integration.yml, and see whether it is time to shard instead) or something is hanging."
elif [ "$status" -eq 137 ]; then
  echo "::error title=Integration suite was killed::${what} was killed by SIGKILL after ${elapsed}s, inside its ${budget} budget. That is something outside this script — the runner's out-of-memory killer is the usual one. Raising the budget will not help."
fi

exit "$status"
