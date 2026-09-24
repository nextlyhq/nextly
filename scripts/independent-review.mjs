#!/usr/bin/env node

/**
 * Whether every pull request the merge queue is about to land has an
 * independent review of the exact revision it lands.
 *
 * A change is reviewed by a model from a different family than the one that
 * wrote it. The standing reviewer is Codex, a GPT model; when it is held up by
 * a rate or quota limit it is substituted, never skipped, by the Nextly review
 * bot, a GLM model run on request (`@nextly-bot review`). A change from any
 * other family is independent of both; one from either family needs the
 * other. Nothing records which model wrote a change, so this accepts either
 * reviewer and cannot tell those cases apart; it says so here rather than
 * implying it can.
 *
 * Coverage means the revision being merged: a review of an earlier head, or
 * one made before the base last moved, read a different diff. The Codex half is
 * `ci-verdict`'s decision, reused, so this gate and the merge-verification gate
 * cannot disagree about whether Codex read a revision.
 *
 * The review bot posts as `github-actions[bot]`, the identity every workflow
 * here shares, so its reviews are known by what they carry: the header and the
 * hidden marker its review protocol writes, the marker naming the exact
 * commit, on a review GitHub records against that commit. That is content, not
 * identity, and weaker than a login of its own would be.
 *
 * It decides in the merge queue, where the queued pull requests are named by the
 * `(#number)` GitHub gives each squash commit. The queue lands those commits,
 * so they are exactly the pull requests this run decides for.
 *
 * Usage (in the workflow, on `merge_group`): GH_TOKEN=… node scripts/independent-review.mjs
 */
import { completeRevisionSet, latestBaseChange, reviewersCovering, SUBMITTED_REVIEW_STATES } from "./ci-verdict.mjs";
import { isCliEntry } from "./cli-entry.mjs";
import { countRewriteEvents } from "./verify-merge.mjs";
import { commandText, eventPayload, queuedCommitSubjects, readGit } from "./workflow-context.mjs";

export const CODEX = "chatgpt-codex-connector[bot]";
export const REVIEW_BOT = "github-actions[bot]";
const REVIEW_BOT_HEADER = /^## Nextly Review Bot: round \d+/;
const REVIEW_BOT_MARKER = /<!-- pr-review-agent round:\d+ head:([0-9a-f]{40}) -->/;
const QUEUED_NUMBER = /\(#([1-9]\d*)\)$/;
const SUBMITTED = new Set(SUBMITTED_REVIEW_STATES);
const MAX_PAGES = 10;

/**
 * The pull requests a queue run lands, from its commits' subjects, or why they
 * cannot all be named. A commit without its `(#number)` is refused rather than
 * skipped: a skipped one is a pull request that lands with nobody asked about it.
 */
export function queuedPullNumbers(subjects) {
  const found = subjects.map(subject => ({ subject, number: QUEUED_NUMBER.exec(subject)?.[1] }));
  const unnamed = found.filter(entry => !entry.number).map(entry => `"${entry.subject}"`);
  if (unnamed.length > 0) return { problem: `Cannot tell which pull request these queued commits belong to: ${unnamed.join(", ")}.` };
  return { numbers: found.map(entry => Number(entry.number)) };
}

/** What a review must carry to be the review bot's verdict on `head`. */
const REVIEW_BOT_TESTS = [
  review => review?.user?.login === REVIEW_BOT,
  (review, head) => review?.commit_id === head,
  review => SUBMITTED.has(review?.state),
  review => REVIEW_BOT_HEADER.test(bodyOf(review)),
  (review, head) => REVIEW_BOT_MARKER.exec(bodyOf(review))?.[1] === head,
];

function bodyOf(review) {
  return typeof review?.body === "string" ? review.body : "";
}

/** Whether the review bot reviewed `head`, after the base last moved. */
export function reviewBotCoversHead(reviews, head, since) {
  return reviews.some(review => REVIEW_BOT_TESTS.every(test => test(review, head)) && inScope(review, since));
}

/** A review made before the base last moved read a diff that no longer exists. */
function inScope(review, since) {
  return since === undefined || (typeof review?.submitted_at === "string" && review.submitted_at > since);
}

/**
 * The verdict for one queued pull request, from its evidence: which reviewer,
 * if any, independently reviewed the revision it lands.
 */
export function coverage({ number, pr, reviews, comments, commits, timeline }) {
  const head = pr.head.sha;
  const options = {
    since: latestBaseChange(timeline),
    knownRevisions: completeRevisionSet(commits.map(commit => commit?.sha), pr.commits),
    historyRewritten: countRewriteEvents(timeline) > 0,
  };
  const by = coveringReviewer(reviews, comments, head, options);
  return { number, head, covered: by !== null, by };
}

function coveringReviewer(reviews, comments, head, options) {
  if (reviewersCovering(reviews, comments, head, options).includes(CODEX)) return "Codex";
  return reviewBotCoversHead(reviews, head, options.since) ? "the Nextly review bot" : null;
}

async function getJson(path, { token, fetchImpl }) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Every page of a list, kept as pages; a list longer than the ceiling is refused rather than cut short. */
async function getPages(path, context) {
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await getJson(`${path}?per_page=100&page=${page}`, context);
    pages.push(items);
    if (items.length < 100) return pages;
  }
  throw new Error(`GET ${path}: more than ${MAX_PAGES * 100} items`);
}

async function evidenceFor(number, context) {
  const repo = context.repository;
  const [pr, reviews, comments, commits, timeline] = await Promise.all([
    getJson(`repos/${repo}/pulls/${number}`, context),
    getPages(`repos/${repo}/pulls/${number}/reviews`, context),
    getPages(`repos/${repo}/issues/${number}/comments`, context),
    getPages(`repos/${repo}/pulls/${number}/commits`, context),
    getPages(`repos/${repo}/issues/${number}/timeline`, context),
  ]);
  return { number, pr, reviews: reviews.flat(), comments: comments.flat(), commits: commits.flat(), timeline };
}

/** The queued pull requests' numbers for this run, or why there are none. */
function queuedNumbers(env, git) {
  if (env.GITHUB_EVENT_NAME !== "merge_group") {
    return { problem: `This check decides in the merge queue; a ${env.GITHUB_EVENT_NAME || "missing"} event has no queued revision.` };
  }
  const queued = queuedCommitSubjects(eventPayload(env), git);
  return queued.problem ? queued : queuedPullNumbers(queued.subjects);
}

/** Decides for the workflow step that invokes this file, and returns the exit code. */
export async function main(env = process.env, { git = readGit, fetchImpl = fetch } = {}) {
  const named = queuedNumbers(env, git);
  if (named.problem) return refuse(named.problem);
  const context = { repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, fetchImpl };
  try {
    return report(await Promise.all(named.numbers.map(async number => coverage(await evidenceFor(number, context)))));
  } catch (error) {
    return refuse(`Could not read the queued pull requests' reviews: ${error.message}`);
  }
}

/** Prints each queued pull request's verdict, in queue order, and fails when any lacks a review. */
function report(verdicts) {
  for (const verdict of verdicts) console.log(verdictLine(verdict));
  if (verdicts.every(verdict => verdict.covered)) return 0;
  console.error("Codex reviews each push; when it is held up by a rate or quota limit, comment `@nextly-bot review` on the pull request for the standby.");
  return 1;
}

/** A covered pull request is logged; an uncovered one is an error annotation naming the revision. */
function verdictLine({ number, head, covered, by }) {
  return covered
    ? `independent-review: #${number} at ${head.slice(0, 9)} was reviewed by ${by}`
    : `::error title=Independent review::#${number} has no independent review of ${head.slice(0, 9)}, the revision the queue would land.`;
}

function refuse(problem) {
  console.log(`::error title=Independent review::${commandText(problem)}`);
  return 1;
}

if (isCliEntry(import.meta.url)) process.exit(await main());
