#!/usr/bin/env node

/**
 * A pull request's title, held to Conventional Commits and this repository's
 * types and scopes, on a pull request's own events and in the merge queue alike.
 *
 * The squash commit that lands on `main` takes its message from the title, so
 * the title is checked where it is written, when a pull request opens or its
 * title changes, and again where it merges. The merge queue lands exactly the
 * commits it tested, so there the check reads those commits: every one between
 * the queue's base and its head, one squash commit per queued pull request.
 * That covers each member of a group, not only the one the queue's branch is
 * named for, and it judges the message that will land even if a title was
 * edited after it was queued.
 *
 * The rules are inputs of `.github/workflows/pr-title.yml`, passed through
 * `.github/actions/pr-title`, so the scope list stays in the one place AGENTS.md
 * and the measured facts are held to.
 *
 * The header grammar is the one the Conventional Commits changelog preset
 * parses: `type(scope)!: subject`, where the scope is optional and may be a
 * comma-separated list, and `!` marks a breaking change. A title starting with
 * `[WIP]` is refused: a pull request that is not ready to merge is a draft, and
 * a check that passed it would let `[WIP]` reach `main` as a commit message.
 *
 * Usage (from the action):
 *   TYPES=… SCOPES=… [REQUIRE_SCOPE=true] [SUBJECT_PATTERN=…] [SUBJECT_PATTERN_ERROR=…] \
 *   node scripts/pr-title.mjs
 *
 * Reads the event from GITHUB_EVENT_NAME and GITHUB_EVENT_PATH, and the queued
 * commits from the checkout's history, and writes `error_message` to
 * GITHUB_OUTPUT when a title is refused.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { isCliEntry } from "./cli-entry.mjs";
import { eventPayload, readGit } from "./workflow-context.mjs";

const HEADER = /^(\w*)(?:\((.*)\))?!?: (.*)$/;
const WIP = /^\[WIP\]\s/;

/** The rules, from the action's inputs: one type or scope per line. */
export function rulesFrom(env) {
  return {
    types: lines(env.TYPES),
    scopes: lines(env.SCOPES),
    requireScope: env.REQUIRE_SCOPE === "true",
    subjectPattern: env.SUBJECT_PATTERN ? new RegExp(env.SUBJECT_PATTERN) : null,
    subjectPatternError: (env.SUBJECT_PATTERN_ERROR ?? "").trim(),
  };
}

function lines(text = "") {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * Why a title is refused, or null when it passes. The checks, and their
 * messages, follow the order a reader fixes them in: the prefix, then its
 * type and scopes, then the subject.
 */
export function titleProblem(title, rules) {
  if (WIP.test(title)) return `The title "${title}" is marked [WIP]. Mark a pull request that is not ready as a draft, and remove the prefix.`;
  const header = parseHeader(title);
  return CHECKS.map(check => check(title, header, rules)).find(Boolean) ?? null;
}

function parseHeader(title) {
  const [, type = "", scope, subject = ""] = HEADER.exec(title) ?? [];
  return { type, scope, subject };
}

function headerProblem(title, { type, subject }, { types }) {
  if (!type) return `No release type found in pull request title "${title}". Add a prefix to indicate what kind of release this pull request corresponds to. For reference, see https://www.conventionalcommits.org/\n\n${available(types)}`;
  if (!subject) return `No subject found in pull request title "${title}".`;
  return types.includes(type) ? null : `Unknown release type "${type}" found in pull request title "${title}".\n\n${available(types)}`;
}

function available(types) {
  return `Available types:\n${types.map(type => ` - ${type}`).join("\n")}`;
}

function scopeProblem(title, { scope }, { scopes, requireScope }) {
  if (!scope) return requireScope ? `No scope found in pull request title "${title}". Scope must match one of: ${scopes.join(", ")}.` : null;
  const unknown = scope.split(",").map(part => part.trim()).filter(part => !scopes.includes(part));
  return unknown.length === 0 ? null : unknownScopes(title, unknown, scopes);
}

function unknownScopes(title, unknown, scopes) {
  return `Unknown ${unknown.length > 1 ? "scopes" : "scope"} "${unknown.join(",")}" found in pull request title "${title}". Scope must match one of: ${scopes.join(", ")}.`;
}

/** The pattern must match the whole subject, not merely a part of it. */
function subjectProblem(title, { subject }, { subjectPattern, subjectPatternError }) {
  if (!subjectPattern || matchesWhole(subjectPattern, subject)) return null;
  if (subjectPatternError) return subjectPatternError.replaceAll("{subject}", subject).replaceAll("{title}", title);
  return `The subject "${subject}" found in pull request title "${title}" doesn't match the configured pattern "${subjectPattern.source}".`;
}

function matchesWhole(pattern, text) {
  return pattern.exec(text)?.[0] === text;
}

/** In the order a reader fixes them: the prefix, then its type and scopes, then the subject. */
const CHECKS = [headerProblem, scopeProblem, subjectProblem];

/** Where each event's titles are: in a pull request's own event, or in the commits the queue would land. */
const TITLE_SOURCES = {
  pull_request: ({ payload = {} }) => eventTitle(payload.pull_request?.title),
  pull_request_target: ({ payload = {} }) => eventTitle(payload.pull_request?.title),
  merge_group: queuedSubjects,
};

/**
 * The titles to check for this event, or why there are none. Any event other
 * than a pull request's or the queue's has no title, and says so rather than
 * passing.
 *
 * @returns {{ titles: string[] } | { problem: string }}
 */
export function titlesFor(context, git = readGit) {
  return Object.hasOwn(TITLE_SOURCES, context.event) ? TITLE_SOURCES[context.event](context, git) : noTitle(context.event);
}

function noTitle(event) {
  return { problem: `There is no pull request title to check on a ${event || "missing"} event.` };
}

function eventTitle(title) {
  return typeof title === "string" ? { titles: [title] } : { problem: "The event carries no pull request title." };
}

/**
 * The subjects of the commits the queue would put on `main`, oldest first.
 * With squash merging each is one pull request's commit, its subject the title
 * and `(#number)`; a merge commit's subject is not a Conventional Commits
 * title, so a queue that merges rather than squashes is refused here too.
 */
function queuedSubjects({ payload }, git) {
  const range = payload?.merge_group ?? {};
  return bothEnds(range) ? subjectsBetween(range.base_sha, range.head_sha, git) : { problem: "The merge-queue event names no base or no head commit." };
}

function bothEnds({ base_sha: base, head_sha: head }) {
  return Boolean(base && head);
}

function subjectsBetween(base, head, git) {
  const log = git(["log", "--reverse", "--format=%s%x00", `${base}..${head}`]);
  if (!log.ok) return { problem: `Could not read the commits between the queue's base ${base} and its head ${head}.` };
  const titles = log.out.split("\0").map(subject => subject.trim()).filter(Boolean);
  return titles.length > 0 ? { titles } : { problem: "The merge queue's head adds no commits to its base." };
}

/** Why any of several titles is refused, each named, or null when all pass. */
export function titlesProblem(titles, rules) {
  const refused = titles.map(title => titleProblem(title, rules)).filter(Boolean);
  return refused.length > 0 ? refused.join("\n\n") : null;
}

/** Checks the title for the workflow step that invokes this file, and returns the exit code. */
export function main(env = process.env, git = readGit) {
  const found = titlesFor({ event: env.GITHUB_EVENT_NAME, payload: eventPayload(env) }, git);
  const problem = found.problem ?? titlesProblem(found.titles, rulesFrom(env));
  return problem ? refuse(env, problem) : accept(found.titles);
}

function refuse(env, problem) {
  writeOutput(env, problem);
  console.log(`::error title=PR title::${commandText(problem.split("\n")[0])}`);
  console.error(problem);
  return 1;
}

function accept(titles) {
  for (const title of titles) console.log(`pr-title: "${title}" follows Conventional Commits`);
  return 0;
}

/** Text inside a workflow command, where `%`, CR and LF would otherwise be read as syntax. */
function commandText(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** A multi-line output, fenced by a delimiter no title can contain. Absent when the title passed. */
function writeOutput(env, message) {
  if (!env.GITHUB_OUTPUT) return;
  const fence = `EOF_${randomUUID()}`;
  appendFileSync(env.GITHUB_OUTPUT, `error_message<<${fence}\n${message}\n${fence}\n`);
}

if (isCliEntry(import.meta.url)) process.exit(main());
