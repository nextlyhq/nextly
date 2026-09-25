#!/usr/bin/env node

/**
 * Whether every pull request the merge queue is about to land has an
 * independent review of the exact revision it lands.
 *
 * A change is reviewed by a model from a different family than the one that
 * wrote it, because a model judging its own family's work tends to favour it.
 * The reviewer is Codex, a GPT model, which posts under a GitHub App identity
 * of its own that no workflow or person here can post as. Nothing records which
 * model wrote a change, so a change written by a GPT model would pass on a
 * Codex review as well; this cannot tell that case apart, and says so here
 * rather than implying it can.
 *
 * Only an identity the change cannot use counts. The Nextly review bot, the
 * standby reviewer, posts as `github-actions[bot]`, the identity every
 * workflow here shares, and a workflow on any pushed branch can post a review
 * that reads exactly like one of its own. So its reviews are not counted: a
 * login that anything can post as says nothing about who reviewed.
 *
 * Coverage means the revision being merged. A review of an earlier head read
 * a different change, and so did one made before the pull request was moved
 * to another base branch. `main` advancing under an unchanged head does not
 * void a review, as it voids no approval on GitHub: the review is of the
 * change, and the queue itself re-tests the change on the latest `main`. The
 * decision is `ci-verdict`'s, reused, so this gate and the merge-verification
 * gate cannot disagree about whether Codex read a revision.
 *
 * Codex states a clean pass only in a summary comment that names the revision
 * by an abbreviation. Once a branch's history was rewritten, the pull
 * request's own commits can no longer show that an abbreviation is unique, so
 * GitHub, which holds every object, is asked to resolve it; it resolves an
 * ambiguous one to nothing.
 *
 * It decides in the merge queue, where the queued pull requests are named by the
 * `(#number)` GitHub gives each squash commit. The queue lands those commits,
 * so they are exactly the pull requests this run decides for.
 *
 * Usage (in the workflow, on `merge_group`): GH_TOKEN=… node scripts/independent-review.mjs
 */
import { completeRevisionSet, latestBaseChange, reviewedCommitFrom, reviewersCovering } from "./ci-verdict.mjs";
import { isCliEntry } from "./cli-entry.mjs";
import { countRewriteEvents } from "./verify-merge.mjs";
import { commandText, eventPayload, queuedCommitSubjects, readGit } from "./workflow-context.mjs";

export const CODEX = "chatgpt-codex-connector[bot]";
const QUEUED_NUMBER = /\(#([1-9]\d*)\)$/;
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

/**
 * The verdict for one queued pull request, from its evidence: whether Codex
 * reviewed the revision it lands, since the pull request last moved to another
 * base branch. `resolved` holds what GitHub resolved each abbreviation to.
 */
export function coverage({ number, pr, reviews, comments, commits, timeline, resolved = {} }) {
  const head = pr.head.sha;
  const options = {
    since: latestBaseChange(timeline),
    knownRevisions: completeRevisionSet(commits.map(commit => commit?.sha), pr.commits),
    historyRewritten: countRewriteEvents(timeline) > 0,
    resolvedRevisions: resolved,
  };
  const covered = reviewersCovering(reviews, comments, head, options).includes(CODEX);
  return { number, head, covered, by: covered ? "Codex" : null };
}

/** A GitHub API resource, or undefined where GitHub answers one of the `absentOn` statuses; any other failure throws. */
async function getJson(path, { token, fetchImpl }, absentOn = []) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/${path}`, { headers });
  if (absentOn.includes(response.status)) return undefined;
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Every page of a list, kept as pages. A list longer than the ceiling is
 * refused rather than cut short; a full last page may be the whole list, so
 * only an item past the ceiling refuses it.
 */
async function getPages(path, context) {
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = await getJson(`${path}?per_page=100&page=${page}`, context);
    pages.push(items);
    if (items.length < 100) return pages;
  }
  const beyond = await getJson(`${path}?per_page=100&page=${MAX_PAGES + 1}`, context);
  if (beyond.length > 0) throw new Error(`GET ${path}: more than ${MAX_PAGES * 100} items`);
  return pages;
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
  const evidence = { number, pr, reviews: reviews.flat(), comments: comments.flat(), commits: commits.flat(), timeline };
  return { ...evidence, resolved: await resolvedAbbreviations(evidence, context) };
}

/**
 * After a rewrite, the full revision GitHub resolves each abbreviation to, for
 * every Codex comment that names a prefix of the head. Without a rewrite the
 * pull request's own commits settle an abbreviation, and nothing is asked.
 */
async function resolvedAbbreviations({ pr, comments, timeline }, context) {
  if (countRewriteEvents(timeline) === 0) return {};
  const head = pr.head.sha.toLowerCase();
  const named = comments.filter(comment => comment?.user?.login === CODEX).map(comment => reviewedCommitFrom(comment?.body));
  const prefixes = [...new Set(named.filter(abbreviation => abbreviation !== undefined && head.startsWith(abbreviation)))];
  const resolved = await Promise.all(prefixes.map(async abbreviation => [abbreviation, await resolveRevision(abbreviation, context)]));
  return Object.fromEntries(resolved.filter(([, revision]) => revision !== undefined));
}

/**
 * GitHub answers 422 for an abbreviation that names no single commit it
 * holds. It reads the name as a ref first, though, wherever git's rules would
 * find one, and anyone who can push can point a ref at any commit; its only
 * lookup that takes nothing but an object ID wants all of one. So an
 * abbreviation that is also a ref's name, in any of those places, resolves to
 * nothing here.
 */
async function resolveRevision(abbreviation, context) {
  if (await namesRef(abbreviation, context)) return undefined;
  const commit = await getJson(`repos/${context.repository}/commits/${abbreviation}`, context, [422]);
  return commit?.sha?.toLowerCase();
}

/** Where git's rules look for a ref of a name before reading it as an abbreviation, under `refs/`, as gitrevisions lists them. */
const refPlaces = name => [name, `tags/${name}`, `heads/${name}`, `remotes/${name}`, `remotes/${name}/HEAD`];

/** Whether a ref git would read this name as exists; GitHub looks each place up exactly. */
async function namesRef(name, context) {
  const refs = await Promise.all(refPlaces(name).map(place => getJson(`repos/${context.repository}/git/ref/${place}`, context, [404])));
  return refs.some(ref => ref !== undefined);
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
  console.error("Codex reviews each push. When it has not reviewed the revision named above, comment `@codex review` on that pull request to ask for one, then queue it again.");
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
