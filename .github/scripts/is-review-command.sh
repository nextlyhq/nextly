#!/usr/bin/env bash
# Decide whether a comment ASKS for a review, printing `true` or `false`.
#
# The review workflow consults it before anything expensive starts: its job
# condition can only ask whether the bot was mentioned at all, since
# `contains` cannot express a line boundary.
#
# The command must occupy a line of its own. Talking ABOUT the command is the
# common case and must stay cheap, so the line holds the command and nothing
# else: `@nextly-bot`, then `review` or `re-review`, with at most a `please`
# before it, `this` or `the` and `PR` or `pull request` after it, `again`, a
# closing `please`, and a full stop or an exclamation mark. A line that goes on
# is talking, and a question is asking something else:
#
#   @nextly-bot review                      -> true
#     @nextly-bot   review                  -> true  (leading space, inner runs)
#   @nextly-bot please review this PR       -> true  (the polite words)
#   @nextly-bot, re-review please.          -> true
#   please look at this                     -> false
#   `@nextly-bot review` failed?            -> false (quoted, and the line continues)
#   @nextly-bot reviewer status?            -> false (`reviewer`, not `review`)
#   @nextly-bot review this PR?             -> false (a question)
#   @nextly-bot why is this a P1?           -> false (a question)
#   @nextly-bot review the auth part only   -> false (more than the command)
#
# The body arrives in COMMENT_BODY rather than as an argument, and no caller
# interpolates it into a shell line: comment text is attacker-controlled, and a
# workflow that pastes it into `run:` is the classic Actions script injection.
set -euo pipefail

body="${COMMENT_BODY-}"

if printf '%s\n' "$body" |
  grep -qiE '^[[:space:]]*@nextly-bot[,:]?[[:space:]]+(please[[:space:]]+)?(re-?)?review([[:space:]]+(this|the))?([[:space:]]+(pr|pull[[:space:]]+request))?([[:space:]]+again)?(,?[[:space:]]+please)?[[:space:]]*[.!]*[[:space:]]*$'; then
  echo "true"
else
  echo "false"
fi
