#!/usr/bin/env node

/**
 * A pull request's title, held to Conventional Commits and this repository's
 * types and scopes, on a pull request's own events and in the merge queue alike.
 *
 * The squash commit that lands on `main` takes its message from the title, so
 * the title is checked where it is written, when a pull request opens or its
 * title changes, and again where it merges. In the merge queue the title is
 * read back from the queued pull request, because a title edited after that
 * pull request joined the queue is the one the commit will carry.
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
 *   [GH_TOKEN=…] node scripts/pr-title.mjs
 *
 * Reads the event from GITHUB_EVENT_NAME and GITHUB_EVENT_PATH, and writes
 * `error_message` to GITHUB_OUTPUT when the title is refused.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { isCliEntry } from "./cli-entry.mjs";

const HEADER = /^(\w*)(?:\((.*)\))?!?: (.*)$/;
const WIP = /^\[WIP\]\s/;
const QUEUE_REF = /^refs\/heads\/gh-readonly-queue\/.+\/pr-(\d+)-[0-9a-f]{40}$/;

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

/**
 * Which pull request a merge-queue run is testing, from the branch the queue
 * made for it: `gh-readonly-queue/<base>/pr-<number>-<base sha>`. Null for any
 * other branch, so a name that only resembles one is not read as a number.
 */
export function queuedPullNumber(headRef) {
  const match = QUEUE_REF.exec(headRef ?? "");
  return match ? Number(match[1]) : null;
}

/** Where each event's title is: in a pull request's own event, or behind the queue's branch. */
const TITLE_SOURCES = {
  pull_request: ({ payload = {} }) => eventTitle(payload.pull_request?.title),
  pull_request_target: ({ payload = {} }) => eventTitle(payload.pull_request?.title),
  merge_group: queuedTitle,
};

/**
 * The title to check for this event, or why there is none. On a pull request
 * it is in the event; in the merge queue it is read from GitHub's record of
 * that pull request, so an edit made after it was queued is the title judged.
 * Any other event has no title, and says so rather than passing.
 *
 * @returns {Promise<{ title: string } | { problem: string }>}
 */
export async function titleFor(context, fetchImpl = fetch) {
  return Object.hasOwn(TITLE_SOURCES, context.event) ? TITLE_SOURCES[context.event](context, fetchImpl) : noTitle(context.event);
}

function noTitle(event) {
  return { problem: `There is no pull request title to check on a ${event || "missing"} event.` };
}

async function queuedTitle({ payload = {}, repository, token }, fetchImpl) {
  const ref = payload.merge_group?.head_ref;
  const number = queuedPullNumber(ref);
  return number ? fetchTitle({ repository, number, token }, fetchImpl) : { problem: `Cannot tell which pull request the merge queue is testing from "${ref}".` };
}

function eventTitle(title) {
  return typeof title === "string" ? { title } : { problem: "The event carries no pull request title." };
}

async function fetchTitle({ repository, number, token }, fetchImpl) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${number}`, { headers });
    if (!response.ok) return { problem: `Could not read pull request #${number}: HTTP ${response.status}.` };
    return eventTitle((await response.json()).title);
  } catch (error) {
    return { problem: `Could not read pull request #${number}: ${error.message}.` };
  }
}

/** Checks the title for the workflow step that invokes this file, and returns the exit code. */
export async function main(env = process.env, fetchImpl = fetch) {
  const payload = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
  const found = await titleFor({ event: env.GITHUB_EVENT_NAME, payload, repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }, fetchImpl);
  const problem = found.problem ?? titleProblem(found.title, rulesFrom(env));
  if (problem) {
    writeOutput(env, problem);
    console.log(`::error title=PR title::${commandText(problem.split("\n")[0])}`);
    console.error(problem);
    return 1;
  }
  console.log(`pr-title: "${found.title}" follows Conventional Commits`);
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

if (isCliEntry(import.meta.url)) process.exit(await main());
