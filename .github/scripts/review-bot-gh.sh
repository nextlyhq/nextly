#!/usr/bin/env bash
# Narrow gateway to the GitHub API for the review bot.
#
# The agent is allowed to run this script instead of `gh api` directly. Every
# request here is built from a fixed endpoint template plus validated
# arguments, so nothing the agent passes can redirect a call to another host:
# `gh api` reads the target host from `--hostname`/`GH_HOST`, and neither is
# reachable through this interface. That is what keeps the model API key in the
# environment from leaving the runner if a hostile PR hijacks the agent.
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
    require_sha "${1:-}"
    [[ -n "${2:-}" ]] || die "usage: file-at <sha> <path>"
    exec gh api "repos/$REPO/contents/$2?ref=$1" --jq '.content' --header "Accept: application/vnd.github.raw+json"
    ;;
  post-review)
    # The agent composes the review JSON; this only decides where it is sent.
    require_number "${1:-}"
    require_file "${2:-}"
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
    die "usage: review-bot-gh.sh {pr|diff|reviews|review-comments|issue-comments|files|threads|file-at|post-review|reply} ..."
    ;;
esac
