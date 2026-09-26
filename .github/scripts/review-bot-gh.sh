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
    # One id per line for this bot's reviews at one commit, sorted so the set
    # can be differenced. The bot posts as its own GitHub App, so its reviews
    # are the ones under that App's login. Emitting a value PER MATCH rather
    # than per page is what makes this survive pagination: `--paginate --jq`
    # runs the expression once per page, so an expression that returns a single
    # value returns one per page, and a numeric test on the result then fails
    # open.
    require_number "${1:-}"
    require_sha "${2:-}"
    gh api --paginate "repos/$REPO/pulls/$1/reviews" \
      --jq ".[] | select(.user.login == \"nextly-review-bot[bot]\" and .commit_id == \"$2\") | .id" |
      sort
    ;;
  post-review)
    # The agent composes the review JSON; this only decides where it is sent.
    #
    # An expected head may be given, and when it is, the PR is re-read here and
    # the post refused if the branch has moved. The agent checks the head when
    # it starts, which leaves the whole length of a review as a window in which
    # a push can land; closing it at the moment of writing is what keeps a
    # review from describing a commit nobody is looking at any more.
    require_number "${1:-}"
    require_file "${2:-}"
    if [ -n "${3:-}" ]; then
      require_sha "$3"
      current=$(gh api "repos/$REPO/pulls/$1" --jq '.head.sha')
      [ "$current" = "$3" ] || die "head moved to $current since $3 was reviewed; not posting"
    fi
    exec gh api --method POST "repos/$REPO/pulls/$1/reviews" --input "$2"
    ;;
  reply)
    # Reply inside an existing review thread; the body comes from a file so no
    # comment text has to survive shell quoting.
    require_number "${1:-}"
    require_number "${2:-}"
    require_file "${3:-}"
    exec gh api --method POST "repos/$REPO/pulls/$1/comments" \
      -F in_reply_to="$2" -F body=@"$3"
    ;;
  *)
    die "usage: review-bot-gh.sh {pr|head-sha|diff|reviews|review-ids-at|review-comments|issue-comments|files|threads|file-at|base-file|delta|line-history|post-review|reply} ..."
    ;;
esac
