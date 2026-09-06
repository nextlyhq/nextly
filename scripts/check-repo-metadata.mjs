#!/usr/bin/env node

/**
 * The repository's own GitHub metadata says what the project is, and no file check can see it.
 *
 * `check-docs-claims.mjs` reads git's index, so it enforces the category across README.md,
 * AGENTS.md, docs and the published packages. The About line and the topic list are not files
 * in the index — they are repository settings — so every one of those checks is blind to them.
 * The result was measurable: with all six guarded surfaces clean and zero occurrences of the
 * retired category in any tracked file, the About line still opened "the open-source, type-safe
 * app framework for Next.js", which is the first sentence a visitor to a public repository
 * reads.
 *
 * A release checklist would close it on the days someone remembers. This runs every time.
 *
 * The category pattern is imported rather than restated: two copies of the definition of what
 * the project is no longer called is how the second one gets missed.
 *
 * Usage:
 *   node scripts/check-repo-metadata.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RETIRED_CATEGORY, namesRetiredCategory } from "./check-docs-claims.mjs";

const OWNER = "nextlyhq";
const REPO = "nextly";

/**
 * Topics the search descriptor commits to.
 *
 * There is no matching list of forbidden ones. A GitHub topic is the same kind of tag as an
 * npm keyword, so which topics name the retired category is decided by the shared
 * `namesRetiredCategory` classifier. Listing them here instead would be a second copy of the
 * definition, free to disagree with the first — and it did: the list held only the singular
 * spellings, so `frameworks` and `app-frameworks` passed a check that rejects them as keywords.
 */
const REQUIRED_TOPICS = [
  "cms",
  "headless-cms",
  "page-builder",
  "nextjs",
  "content-platform",
];

/** The package whose description the About line must match. The root manifest has none. */
const DESCRIPTION_SOURCE = "packages/nextly/package.json";

/**
 * Whether an HTTP status means the configured repository cannot be read, as opposed to a
 * moment when GitHub could not answer.
 *
 * The distinction is the whole value of the unverifiable result. A 404 is what a renamed
 * repository or a stale `OWNER` returns, and treating it as transient would leave this check
 * green for as long as the mistake lasted, examining no metadata at all.
 *
 * 403 is the ambiguous one, and the headers are what resolve it: GitHub returns 403 both for
 * rate limiting, which recovers, and for a repository this credential may not read, which does
 * not. Reading only the status would classify a permanent refusal as a moment to try again.
 */
export function isPermanentStatus(status, headers) {
  if (status === 429) return false;
  if (status === 403) {
    const remaining = headers?.get?.("x-ratelimit-remaining");
    const retryAfter = headers?.get?.("retry-after");
    // Primary limit exhausts the quota; a secondary limit answers with retry-after instead.
    return !(remaining === "0" || retryAfter);
  }
  if (status >= 500) return false; // GitHub's side, and it recovers
  return status >= 400;
}

/**
 * Whether an unreadable API must fail the run rather than report itself unverifiable.
 *
 * The scheduled run exists only to observe a setting no file check can see, so a scheduled
 * run that examined nothing did not do the one thing it is for, and reporting success would
 * make it indistinguishable from a clean pass. Everywhere else the softer result is right: a
 * check that goes red because a laptop is offline teaches people to wave this one through.
 */
export function verificationRequired(env = process.env) {
  return env.GITHUB_EVENT_NAME === "schedule" || env.GITHUB_EVENT_NAME === "workflow_dispatch";
}

/**
 * The token is used when one is offered and the call is unauthenticated otherwise.
 *
 * The repository is public, so no token is needed to read this and a laptop should not have to
 * hold one. But an unauthenticated caller gets 60 requests an hour shared across everything on
 * that IP, and a runner that exhausts it turns this check into a silent pass — the result is
 * "unverifiable", which is not a failure, so the run goes green having examined nothing. A
 * workflow token raises the ceiling far above anything this job could reach.
 */
function authHeaders(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

const TRANSIENT_ATTEMPTS = 3;

export async function fetchRepoMetadata(owner = OWNER, repo = REPO, { fetchImpl = fetch, env = process.env, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { accept: "application/vnd.github+json", ...authHeaders(env) },
      });
      if (response.ok) {
        const body = await response.json();
        return { description: body.description ?? "", topics: body.topics ?? [] };
      }
      const error = new Error(`GitHub API returned ${response.status} for ${owner}/${repo}`);
      error.permanent = isPermanentStatus(response.status, response.headers);
      if (error.permanent) throw error;
      lastError = error;
    } catch (error) {
      if (error.permanent) throw error;
      lastError = error;
    }
    // Retried because a single blip should not file an issue. A permanent status never
    // reaches here, so this never delays the answer that matters.
    if (attempt < TRANSIENT_ATTEMPTS) await delay(attempt * 1000);
  }
  throw lastError;
}

/**
 * Whether the About line must match the package description exactly, or only be reported.
 *
 * The About line is one global repository setting, and a pull request cannot change it. A PR
 * that legitimately edits the package description would otherwise be unmergeable until someone
 * edited the live setting first — which would then fail every other open PR still carrying the
 * old description, and is impossible for a fork author regardless. A check that goes red on a
 * correct change teaches people to wave it through, so drift is advisory on a pull request and
 * blocking everywhere the setting can actually be brought back into line.
 *
 * The category checks are unconditional. Those are absolute claims about what the project is,
 * not a comparison against a value the branch is allowed to move.
 */
export function strictDescriptionMatch(env = process.env) {
  return env.GITHUB_EVENT_NAME !== "pull_request";
}

export function checkRepoMetadata({ metadata, expectedDescription, strictDescription = true }) {
  const findings = [];
  const { description, topics } = metadata;

  if (RETIRED_CATEGORY.test(description)) {
    findings.push({
      check: "about-retired-category",
      message: `the GitHub About line still names the retired category: "${description}"`,
    });
  }

  // Guarding the comparison on a truthy `expectedDescription` would disable it entirely the
  // day the source manifest lost its description, letting any About line pass. The About line
  // is only as trustworthy as the thing it is compared against, so an absent source is itself
  // the finding.
  if (typeof expectedDescription !== "string" || expectedDescription.trim() === "") {
    findings.push({
      check: "description-source-missing",
      message:
        `${DESCRIPTION_SOURCE} has no description, so there is nothing for the GitHub About ` +
        `line to be checked against`,
    });
  } else if (description !== expectedDescription) {
    findings.push({
      check: "about-matches-package",
      advisory: !strictDescription,
      message:
        `the GitHub About line differs from ${DESCRIPTION_SOURCE}. ` +
        `About: "${description}" — package: "${expectedDescription}"`,
    });
  }

  for (const topic of topics) {
    if (!namesRetiredCategory(topic)) continue;
    findings.push({
      check: "topic-forbidden",
      message: `the topic "${topic}" names the retired category and should be removed`,
    });
  }

  for (const topic of REQUIRED_TOPICS) {
    if (!topics.includes(topic)) {
      findings.push({
        check: "topic-missing",
        message: `the topic "${topic}" is part of the search descriptor and is not set`,
      });
    }
  }

  return { findings };
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-repo-metadata.mjs");

if (invokedDirectly) {
  // No `?? ""`: an absent description must stay absent so `description-source-missing` fires
  // rather than being compared as an empty string.
  const { description: expectedDescription } = JSON.parse(
    readFileSync(join(process.cwd(), DESCRIPTION_SOURCE), "utf-8")
  );

  let metadata;
  try {
    metadata = await fetchRepoMetadata();
  } catch (error) {
    if (error.permanent || verificationRequired()) {
      console.error(
        `\nrepo metadata: ${OWNER}/${REPO} could not be read (${error.message})\n\n` +
          (error.permanent
            ? `This status does not recover on its own. Either the repository was renamed or ` +
              `made private and the constants in this script are stale, or it can no longer ` +
              `be read without a token.\n`
            : `This run exists to observe the About line and the topics, and it examined ` +
              `neither, so it cannot report a pass. Re-run it once the API is reachable.\n`)
      );
      process.exit(1);
    }
    // Unverifiable, not failed. A rate limit or an unreachable API says nothing about the
    // metadata, and a check that goes red when the network is down teaches people to wave this
    // one through.
    console.warn(
      `repo metadata: could not be read (${error.message}). Not counted as a failure.`
    );
    process.exit(0);
  }

  const { findings } = checkRepoMetadata({
    metadata,
    expectedDescription,
    strictDescription: strictDescriptionMatch(),
  });

  const advisory = findings.filter(finding => finding.advisory);
  const blocking = findings.filter(finding => !finding.advisory);

  for (const finding of advisory) {
    console.warn(`repo metadata: ${finding.check}: ${finding.message}`);
    console.warn(
      `  Not failing this run: the About line is a repository setting a pull request cannot change.\n`
    );
  }

  if (blocking.length === 0) {
    console.log("repo metadata: About line and topics agree with the category.");
    process.exit(0);
  }

  console.error(`\nrepo metadata: ${blocking.length} finding(s)\n`);
  for (const finding of blocking) {
    console.error(`  ${finding.check}: ${finding.message}`);
  }
  console.error(
    `\nThese are repository settings, not files. Fix them in Settings on GitHub, ` +
      `or with:\n  gh repo edit ${OWNER}/${REPO} --description "..." --add-topic ... --remove-topic ...\n`
  );
  process.exit(1);
}
