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
#   budget   any GNU `timeout` DURATION, e.g. 55m
#   what     what to name in the error, e.g. "the MySQL integration suite"

set -e

if [ "$#" -lt 3 ]; then
  echo "run-with-budget.sh: usage: <budget> <what> <command> [args...]" >&2
  exit 2
fi

budget="$1"
what="$2"
shift 2

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

# `--kill-after` because TERM is a request. A vitest worker wedged on a database
# socket can ignore it, and a budget that a hung process can decline to honour
# is not a budget.
set +e
timeout --kill-after=2m "$budget" "$@"
status=$?
set -e

# 124 is `timeout`'s own "the command timed out"; 137 is 128+SIGKILL, which is
# what the `--kill-after` escalation produces when TERM was ignored. Both mean
# the budget fired, and neither is a result the command produced itself.
if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
  echo "::error title=Integration budget exceeded::${what} ran past its ${budget} budget and was stopped. This is reported as a FAILURE on purpose: a job-level timeout would have been recorded as a cancellation, which no gate reads. Either the suite has genuinely outgrown the budget (raise it in integration.yml, and see whether it is time to shard instead) or something is hanging."
fi

exit "$status"
