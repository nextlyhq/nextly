#!/usr/bin/env bash
# Narrow gateway to the GitHub API, and to the local history, for the review bot.
#
# The agent is allowed to run this script instead of `gh api` or `git`
# directly. Every request here is built from a fixed endpoint template plus
# validated arguments, so nothing the agent passes can redirect a call to
# another host: `gh api` reads the target host from `--hostname`/`GH_HOST`, and
# neither is reachable through this interface. The git commands are fixed the
# same way, so no flag the agent appends can make one write a file or run a
# program. That closes the outbound half of the posture -- the agent cannot
# choose where a request goes -- which is one layer of the threat model set out
# in .github/workflows/nextly-review-bot.yml, not the whole of it.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

die() {
  echo "review-bot-gh: $*" >&2
  exit 2
}

# The review workflow has Claude Code keep credentials out of every command
# the agent runs, this one included, and says so with REVIEW_BOT_EXPECT_SCRUB.
# A model key here then means the scrub did not happen, whatever the workflow
# asked, as when an action stops passing the setting on: stop, rather than go
# on with the key in reach. A caller that does not say so is not held to it.
if [[ "${REVIEW_BOT_EXPECT_SCRUB:-}" == 1 && -n "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  die "a model key reached this command, though the workflow had it scrubbed"
fi

# Every caller-supplied identifier is checked before it reaches a URL, so a
# crafted value cannot smuggle a flag or a second endpoint into the request.
require_number() {
  [[ "${1:-}" =~ ^[0-9]+$ ]] || die "expected a number, got '${1:-}'"
}

require_file() {
  [[ -f "${1:-}" ]] || die "no such file: '${1:-}'"
}

require_sha() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{7,40}$ ]] || die "expected a commit sha, got '${1:-}'"
}

# A path inside the checkout. It is always passed joined to a revision or a
# line range, so it can never stand alone as an option; this refuses what
# could still change its meaning, a leading dash or a line break.
require_path() {
  [[ -n "${1:-}" && "${1:0:1}" != "-" && "$1" != *$'\n'* ]] || die "expected a path, got '${1:-}'"
}

# The tag the post job ends everything it posts with: the workflow run that
# posted it and, for a reply or a file-level comment, its place in the payload
# (`reply:<n>`, `file:<n>`). Re-running a
# failed job re-runs the same run with the same payload, so the tag is how a
# re-run tells what an earlier attempt already posted; a new request is a new
# run, and posts afresh. The tag is appended after the agent's text, so only a
# tag that ENDS a body counts: one the agent wrote into that text, naming some
# other run, is never the last line.
posted_tag() {
  printf '<!-- nextly-review-bot run:%s%s -->' "$1" "${2:+ $2}"
}

# Ids of what this bot posted at an endpoint whose last line is a tag, one per
# line, narrowed to those whose `<field>` is `<value>`: a review's `commit_id`,
# a reply's `in_reply_to_id`. `--paginate` prints each page as an array of its
# own, which jq reads one after another, so a match on any page is found.
posted_ids() {
  gh api --paginate "$1?per_page=100" |
    jq -r --arg tag "$2" --arg field "$3" --arg value "$4" '
      .[]
      | select(.user.login == "nextly-review-bot[bot]" and (.[$field] | tostring) == $value)
      | select((.body // "") | split("\n") | map(rtrimstr("\r") | select(length > 0)) | last == $tag)
      | .id'
}

# The local history the review reads, with every flag fixed here. `git diff`,
# `git show` and `git log` take `--output=<file>` among their options, which
# writes anywhere the runner can, so the agent is given these commands rather
# than a prefix of git it could append a flag to. `--no-ext-diff` and
# `--no-textconv` keep a configured diff driver from running anything.
GIT_READ=(git --no-pager)

command="${1:-}"
shift || true

case "$command" in
  pr)
    # Metadata for one PR. Served from the API rather than `gh pr view` because
    # that command's `--repo` flag accepts a `HOST/OWNER/REPO` form and would
    # reopen the redirect this gateway exists to close.
    require_number "${1:-}"
    exec gh api "repos/$REPO/pulls/$1"
    ;;
  diff)
    require_number "${1:-}"
    exec gh api "repos/$REPO/pulls/$1" --header "Accept: application/vnd.github.v3.diff"
    ;;
  reviews)
    require_number "${1:-}"
    exec gh api --paginate "repos/$REPO/pulls/$1/reviews"
    ;;
  review-comments)
    require_number "${1:-}"
    exec gh api --paginate "repos/$REPO/pulls/$1/comments"
    ;;
  issue-comments)
    require_number "${1:-}"
    exec gh api --paginate "repos/$REPO/issues/$1/comments"
    ;;
  files)
    require_number "${1:-}"
    exec gh api --paginate "repos/$REPO/pulls/$1/files"
    ;;
  threads)
    # Review threads carry the resolution state the multi-round protocol needs,
    # and that state is only exposed through GraphQL.
    require_number "${1:-}"
    exec gh api graphql -F owner="$OWNER" -F name="$NAME" -F number="$1" -f query='
      query($owner:String!,$name:String!,$number:Int!){
        repository(owner:$owner,name:$name){
          pullRequest(number:$number){
            reviewThreads(first:100){
              nodes{
                isResolved isOutdated path line
                comments(first:20){ nodes{ author{login} body url databaseId } }
              }
            }
          }
        }
      }'
    ;;
  file-at)
    # Read one file at one commit. Used by the mention workflow, whose checkout
    # is the default branch rather than the PR head.
    # The raw media type returns the file body itself, so there is no JSON
    # envelope here to select a field out of.
    require_sha "${1:-}"
    [[ -n "${2:-}" ]] || die "usage: file-at <sha> <path>"
    exec gh api "repos/$REPO/contents/$2?ref=$1" --header "Accept: application/vnd.github.raw+json"
    ;;
  head-sha)
    require_number "${1:-}"
    exec gh api "repos/$REPO/pulls/$1" --jq '.head.sha'
    ;;
  base-file)
    # One file as `main` has it: `git show origin/main:<path>`, from the local
    # clone, which the workflow fetches whole.
    require_path "${1:-}"
    exec "${GIT_READ[@]}" show --no-ext-diff --no-textconv "origin/main:$1"
    ;;
  delta)
    # What changed since an earlier reviewed commit: `git diff <sha>..HEAD`.
    require_sha "${1:-}"
    exec "${GIT_READ[@]}" diff --no-ext-diff --no-textconv "$1..HEAD"
    ;;
  line-history)
    # How lines came to be: `git log -L <start>,<end>:<path>`, on HEAD unless
    # `main` is asked for.
    [[ "${1:-}" =~ ^[0-9]+,[0-9]+$ ]] || die "expected <start>,<end>, got '${1:-}'"
    require_path "${2:-}"
    case "${3:-HEAD}" in
      HEAD) rev=HEAD ;;
      main) rev=origin/main ;;
      *) die "expected HEAD or main, got '${3:-}'" ;;
    esac
    exec "${GIT_READ[@]}" log --no-ext-diff --no-textconv -L "$1:$2" "$rev"
    ;;
  review-ids-at)
    # The reviews one run of the workflow posted at one commit, one id per
    # line. The bot posts as its own GitHub App, so its reviews are the ones
    # under that App's login, and the run's tag tells which of them this run
    # posted, on this attempt or an earlier one.
    require_number "${1:-}"
    require_sha "${2:-}"
    require_number "${3:-}"
    posted_ids "repos/$REPO/pulls/$1/reviews" "$(posted_tag "$3")" commit_id "$2"
    ;;
  post-review)
    # The agent composes the review JSON; this only decides where it is sent,
    # and tags it with the run that sends it.
    #
    # The PR is re-read here and the post refused if the branch has moved since
    # the head reviewed. The agent checks the head when it starts, which leaves
    # the whole length of a review as a window in which a push can land;
    # closing it at the moment of writing is what keeps a review from
    # describing a commit nobody is looking at any more.
    #
    # A run posts its review once. Re-running a failed job posts the same
    # payload again, and a POST whose response was lost may well have landed,
    # so a review this run already posted at this head is reported rather than
    # posted twice. Not knowing is not taken as "not yet": if the reviews
    # cannot be read, nothing is posted.
    require_number "${1:-}"
    require_file "${2:-}"
    require_sha "${3:-}"
    require_number "${4:-}"
    current=$(gh api "repos/$REPO/pulls/$1" --jq '.head.sha')
    [ "$current" = "$3" ] || die "head moved to $current since $3 was reviewed; not posting"
    tag=$(posted_tag "$4")
    posted=$(posted_ids "repos/$REPO/pulls/$1/reviews" "$tag" commit_id "$3") ||
      die "could not read the reviews, so cannot tell whether run $4 already posted; not posting"
    if [ -n "$posted" ]; then
      echo "review-bot-gh: run $4 already posted review ${posted//$'\n'/, } at $3; not posting it again" >&2
      exit 0
    fi
    review=$(jq --arg tag "$tag" '.body += "\n\n" + $tag' "$2")
    exec gh api --method POST "repos/$REPO/pulls/$1/reviews" --input - <<<"$review"
    ;;
  reply)
    # Reply inside an existing review thread; the body comes from a file so no
    # comment text has to survive shell quoting. It is tagged with the run and
    # its place in the payload, and posted once per run as a review is.
    require_number "${1:-}"
    require_number "${2:-}"
    require_file "${3:-}"
    require_number "${4:-}"
    require_number "${5:-}"
    tag=$(posted_tag "$4" "reply:$5")
    posted=$(posted_ids "repos/$REPO/pulls/$1/comments" "$tag" in_reply_to_id "$2") ||
      die "could not read the review comments, so cannot tell whether run $4 already replied; not posting"
    if [ -n "$posted" ]; then
      echo "review-bot-gh: run $4 already posted reply $5 as comment ${posted//$'\n'/, }; not posting it again" >&2
      exit 0
    fi
    reply=$(jq -n --rawfile body "$3" --arg tag "$tag" --argjson to "$2" '{in_reply_to: $to, body: ($body + "\n\n" + $tag)}')
    exec gh api --method POST "repos/$REPO/pulls/$1/comments" --input - <<<"$reply"
    ;;
  post-file-comment)
    # A finding no line of the diff shows, posted as a file-level comment on
    # its file so that it opens a thread as an inline one would. GitHub takes
    # such a comment only on a file the change touches, and asking first is
    # what names the file when one is refused. It goes on the head reviewed,
    # once per run, as a review does.
    require_number "${1:-}"
    require_sha "${2:-}"
    require_path "${3:-}"
    require_file "${4:-}"
    require_number "${5:-}"
    require_number "${6:-}"
    current=$(gh api "repos/$REPO/pulls/$1" --jq '.head.sha')
    [ "$current" = "$2" ] || die "head moved to $current since $2 was reviewed; not posting"
    changed=$(gh api --paginate "repos/$REPO/pulls/$1/files?per_page=100" | jq -r '.[].filename') ||
      die "could not read the changed files, so cannot tell whether $3 is one; not posting"
    grep -qxF -- "$3" <<<"$changed" || die "$3 is not among the files the change touches; not posting"
    tag=$(posted_tag "$5" "file:$6")
    posted=$(posted_ids "repos/$REPO/pulls/$1/comments" "$tag" path "$3") ||
      die "could not read the review comments, so cannot tell whether run $5 already posted it; not posting"
    if [ -n "$posted" ]; then
      echo "review-bot-gh: run $5 already posted file comment $6 as comment ${posted//$'\n'/, }; not posting it again" >&2
      exit 0
    fi
    comment=$(jq -n --rawfile body "$4" --arg tag "$tag" --arg sha "$2" --arg path "$3" '{commit_id: $sha, path: $path, subject_type: "file", body: ($body + "\n\n" + $tag)}')
    exec gh api --method POST "repos/$REPO/pulls/$1/comments" --input - <<<"$comment"
    ;;
  *)
    die "usage: review-bot-gh.sh {pr|head-sha|diff|reviews|review-ids-at|review-comments|issue-comments|files|threads|file-at|base-file|delta|line-history|post-review|reply|post-file-comment} ..."
    ;;
esac
