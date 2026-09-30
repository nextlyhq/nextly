#!/usr/bin/env bash
# Decide whether a comment ASKS for a review, printing `true` or `false`.
#
# The review workflow consults it before anything expensive starts: its job
# condition can only ask whether the bot was mentioned at all, since
# `contains` cannot express a line boundary.
#
# The command must occupy a line of its own. Talking ABOUT the command is the
# common case and must stay cheap:
#
#   @nextly-bot review              -> true
#     @nextly-bot   review          -> true  (leading space, inner runs)
#   please look at this             -> false
#   `@nextly-bot review` failed?    -> false (quoted, and the line continues)
#   @nextly-bot reviewer status?    -> false (`reviewer`, not `review`)
#   @nextly-bot why is this a P1?   -> false (a question, not a request)
#
# The body arrives in COMMENT_BODY rather than as an argument, and no caller
# interpolates it into a shell line: comment text is attacker-controlled, and a
# workflow that pastes it into `run:` is the classic Actions script injection.
set -euo pipefail

body="${COMMENT_BODY-}"

if printf '%s\n' "$body" |
  grep -qiE '^[[:space:]]*@nextly-bot[[:space:]]+review[[:space:]]*$'; then
  echo "true"
else
  echo "false"
fi
