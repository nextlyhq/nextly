#!/usr/bin/env node
/**
 * What became of the review bot's findings, read from GitHub and changing
 * nothing there: for each finding the protocol tagged (`<!-- nrb v1 id:… sev:…
 * lens:… -->`), its severity and lens, the 👍 and 👎 readers gave it, whether
 * its thread was resolved, and whether its lines changed before the merge.
 * Summed by severity and by lens, it shows which findings people act on, and
 * which they rate.
 * Where GitHub's answer cannot tell whether a finding's lines changed, the
 * finding says so (`changed: null`) and is counted apart, not as unchanged.
 *
 * The bot seeds one 👍 and one 👎 on each finding for readers to click, so its
 * own reactions are left out of the counts: a finding nobody rated reads as
 * unrated, not as one vote each way.
 *
 *   node scripts/review-bot-collect.mjs <owner/repo> --pr <n> [--pr <n> ...] [--json]
 *
 * Reads through `gh api`, as the person running it; each PR named is read
 * whole, open or merged.
 */
import { execFileSync } from "node:child_process";

import { isCliEntry } from "./cli-entry.mjs";

/** The login GitHub's REST API gives the review bot. */
export const BOT = "nextly-review-bot[bot]";

/** The tag a finding ends with, read into its parts; null for any other comment. */
export function findingTag(body) {
  const found = /<!-- nrb v1 id:(\d+)\.(\d+) sev:(P[0-3]) lens:(L\d+|A\d+) -->/.exec(body ?? "");
  return found ? { round: Number(found[1]), n: Number(found[2]), severity: found[3], lens: found[4] } : null;
}

/** Readers' 👍 and 👎 on a comment, the bot's own seeded pair left out. */
export function ratings(reactions) {
  const others = (reactions ?? []).filter(reaction => reaction.user?.login !== BOT);
  return { up: others.filter(reaction => reaction.content === "+1").length, down: others.filter(reaction => reaction.content === "-1").length };
}

/** A hunk's header: where its old side starts, and how many lines it spans. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/**
 * The old-side line a hunk's first line is at. A hunk with no old lines names
 * the line its additions follow, so its first line is the one after.
 */
function hunkStart(header) {
  const [, start, count] = HUNK.exec(header);
  return count === "0" ? Number(start) + 1 : Number(start);
}

/**
 * What each kind of patch line does as the patch is read: a header moves to
 * its hunk's first old line; context takes one old line; a removed line takes
 * one and records it. An added line pairs with a removed line before it, as
 * its replacement; past those, a run of added lines is an insertion, and
 * records the two old lines it falls between.
 */
const STEPS = {
  "@": (state, line) => {
    Object.assign(state, { old: hunkStart(line), unpaired: 0, inserting: false });
  },
  " ": state => {
    Object.assign(state, { old: state.old + 1, unpaired: 0, inserting: false });
  },
  "-": state => {
    state.ranges.push([state.old, state.old]);
    Object.assign(state, { old: state.old + 1, unpaired: state.unpaired + 1, inserting: false });
  },
  "+": state => {
    if (state.unpaired > 0) {
      state.unpaired -= 1;
      return;
    }
    if (!state.inserting) state.ranges.push([state.old - 1, state.old]);
    state.inserting = true;
  },
};

/**
 * The line ranges, on the side of `from`, that a compare from `from` to a later
 * commit changed in one file: each line it removed or replaced, and for each
 * run of lines it only added, the two lines that run falls between, so a line
 * added just above or below a finding counts. The context a patch shows around
 * a change is not a change.
 */
export function changedRanges(patch) {
  const state = { old: 0, unpaired: 0, inserting: false, ranges: [] };
  for (const line of (patch ?? "").split("\n")) {
    const step = STEPS[line[0]];
    if (step === undefined) continue;
    step(state, line);
  }
  return state.ranges;
}

/** Whether any of `ranges` overlaps the lines `start` to `end`. */
const overlaps = (ranges, start, end) => ranges.some(([first, last]) => first <= end && last >= start);

/** `read`, asked each path once: the findings of one review share a commit, and so a compare. */
function once(read) {
  const answers = new Map();
  return path => {
    if (!answers.has(path)) answers.set(path, read(path));
    return answers.get(path);
  };
}

/** The first of `values` that is set, or null. */
const firstSet = (...values) => values.find(value => value !== undefined && value !== null) ?? null;

/**
 * Whether a comment is one of the bot's findings: its own, opening a thread (a
 * reply names the comment it answers; one that opens a thread leaves the field
 * out, or null), and tagged.
 */
const isFinding = comment => comment.user?.login === BOT && firstSet(comment.in_reply_to_id) === null && findingTag(comment.body) !== null;

/**
 * Each finding of one PR, with what became of it.
 *
 * @param {(request: string|{query: string, variables: object}) => any} fetch - a GitHub read, as `gh api`
 *   answers it: a REST path, or a GraphQL query with its variables.
 * @param {string} repo - `owner/name`.
 * @param {number} number
 */
export function collectPull(fetch, repo, number) {
  const pull = fetch(`repos/${repo}/pulls/${number}`);
  const comments = fetch(`repos/${repo}/pulls/${number}/comments?per_page=100`);
  const resolved = resolvedComments(fetch, repo, number);
  // The last head, which GitHub keeps after a merge. A squash merge's commit
  // would not do: comparing to it runs from where the branch left main, so
  // every line the branch changed before the review would count.
  const end = pull.head.sha;
  const compare = once(fetch);
  return comments.filter(isFinding).map(comment => ({
    pull: number,
    ...findingTag(comment.body),
    path: comment.path,
    ratings: ratings(fetch(`repos/${repo}/pulls/comments/${comment.id}/reactions?per_page=100`)),
    resolved: resolved.has(comment.id),
    changed: linesChanged(compare, repo, comment, end),
  }));
}

/** The review threads of a PR, a page of 100 after the cursor `after`. */
const THREADS =
  "query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}";

/** The ids of comments that open a resolved thread, read 100 threads at a time. */
function resolvedComments(fetch, repo, number) {
  const [owner, name] = repo.split("/");
  const resolved = new Set();
  let page = { hasNextPage: true, endCursor: null };
  while (page.hasNextPage) {
    const threads = fetch({ query: THREADS, variables: { owner, name, number, after: page.endCursor } }).data.repository.pullRequest.reviewThreads;
    for (const id of resolvedIds(threads.nodes)) resolved.add(id);
    page = threads.pageInfo;
  }
  return resolved;
}

/** The ids of the comments that open the resolved threads among `threads`. */
const resolvedIds = threads => threads.filter(thread => thread.isResolved).map(thread => thread.comments.nodes[0]?.databaseId);

/** The most files GitHub's compare lists; a file past them is left out, whether or not it changed. */
const COMPARE_FILES = 300;

/**
 * Whether the lines a finding names changed between the commit it was made on
 * and `end`, the branch's last head: true, false, or null when GitHub's
 * compare cannot tell.
 */
function linesChanged(fetch, repo, comment, end) {
  const from = firstSet(comment.original_commit_id, comment.commit_id);
  if (from === null || from === end) return false;
  return comparedFrom(readOrNull(fetch, `repos/${repo}/compare/${from}...${end}`), comment);
}

/**
 * What `read` answers for `path`, or null when GitHub says the commits are not
 * there to compare: HTTP 404, or 422 for commits with nothing in common. Any
 * other failure, a login that expired or a rate limit, stops the run, so the
 * report never passes it off as a finding GitHub could not tell.
 */
function readOrNull(read, path) {
  try {
    return read(path);
  } catch (error) {
    if (/HTTP (404|422)\b/.test(String(error?.message))) return null;
    throw error;
  }
}

/**
 * Whether a compare from a finding's commit changed its lines. Only a compare
 * whose head is ahead of that commit runs from it: once a branch is rebased or
 * force-pushed past the finding, the two have diverged, and GitHub diffs from
 * where they forked, which holds every line the branch changed before the
 * finding too. Then which lines changed since is not known.
 */
function comparedFrom(compare, comment) {
  if (compare?.status !== "ahead") return null;
  return changedIn(compare.files ?? [], comment);
}

/**
 * Whether a compare's `files` changed a finding's lines. A file missing from
 * them did not change, unless the compare listed its most files, when it may
 * have; a file renamed is found by its name before.
 */
function changedIn(files, comment) {
  const file = files.find(entry => [entry.filename, entry.previous_filename].includes(comment.path));
  if (file === undefined) return files.length >= COMPARE_FILES ? null : false;
  return patchChanged(file.patch, findingLines(comment));
}

/**
 * The first and last lines a finding names, or null for a file-level finding.
 * GitHub gives a file-level comment line 1 all the same, so it is told by its
 * `subject_type`.
 */
function findingLines(comment) {
  if (comment.subject_type === "file") return null;
  const last = firstSet(comment.original_line, comment.line);
  if (last === null) return null;
  return [firstSet(comment.original_start_line, comment.start_line, last), last];
}

/**
 * Whether a file's patch changed `lines`. A file-level finding names no lines,
 * so any change to its file counts; GitHub leaves out the patch of a diff too
 * large to show, and then which lines changed is not known.
 */
function patchChanged(patch, lines) {
  if (lines === null) return true;
  if (typeof patch !== "string") return null;
  return overlaps(changedRanges(patch), ...lines);
}

/** A finding added into its group's sums. */
function addTo(group, finding) {
  group.findings += 1;
  group.up += finding.ratings.up;
  group.down += finding.ratings.down;
  group.resolved += Number(finding.resolved === true);
  group.changed += Number(finding.changed === true);
  group.unknown += Number(finding.changed === null);
}

/**
 * The findings summed by one of their fields: how many, rated how, resolved
 * and changed how often, and for how many GitHub could not tell.
 */
export function summarize(findings, field) {
  const groups = new Map();
  for (const finding of findings) {
    const key = finding[field];
    if (!groups.has(key)) groups.set(key, { [field]: key, findings: 0, up: 0, down: 0, resolved: 0, changed: 0, unknown: 0 });
    addTo(groups.get(key), finding);
  }
  return [...groups.values()].sort((a, b) => String(a[field]).localeCompare(String(b[field])));
}

/** A Markdown table of one summary. */
export function table(rows, field) {
  const head = `| ${field} | findings | 👍 | 👎 | resolved | lines changed | could not tell |\n|---|---|---|---|---|---|---|`;
  return [head, ...rows.map(row => `| ${row[field]} | ${row.findings} | ${row.up} | ${row.down} | ${row.resolved} | ${row.changed} | ${row.unknown} |`)].join("\n");
}

/**
 * A read through `gh api`: a GraphQL query with its variables, or a REST path.
 * A list is read across all its pages, which `--jq '.[]'` prints one item to a
 * line; compact JSON holds no raw line break, so each line parses alone, whatever
 * brackets a comment's body quotes.
 */
function ghFetch(request) {
  if (typeof request === "object") {
    // A variable with no value is left out, as GraphQL reads a missing one as null.
    const variables = Object.entries(request.variables)
      .filter(([, value]) => value !== null && value !== undefined)
      .flatMap(([name, value]) => ["-F", `${name}=${value}`]);
    return JSON.parse(execFileSync("gh", ["api", "graphql", "-f", `query=${request.query}`, ...variables], { encoding: "utf8" }));
  }
  const path = request;
  const list = /\/(comments|reactions)(\?|$)/.test(path);
  const out = execFileSync("gh", list ? ["api", "--paginate", path, "--jq", ".[]"] : ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (!list) return JSON.parse(out);
  return out
    .split("\n")
    .filter(line => line !== "")
    .map(line => JSON.parse(line));
}

if (isCliEntry(import.meta.url)) {
  const [repo, ...rest] = process.argv.slice(2);
  const pulls = rest.flatMap((arg, i) => (arg === "--pr" ? [Number(rest[i + 1])] : []));
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || pulls.length === 0 || pulls.some(number => !Number.isInteger(number) || number <= 0)) {
    console.error("usage: review-bot-collect.mjs <owner/repo> --pr <n> [--pr <n> ...] [--json]");
    process.exit(2);
  }
  const findings = pulls.flatMap(number => collectPull(ghFetch, repo, number));
  if (rest.includes("--json")) console.log(JSON.stringify(findings, null, 2));
  else console.log(`${findings.length} tagged findings\n\n${table(summarize(findings, "severity"), "severity")}\n\n${table(summarize(findings, "lens"), "lens")}`);
}
