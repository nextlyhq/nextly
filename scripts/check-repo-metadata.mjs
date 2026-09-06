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
 * The distinction is the whole value of the unverifiable result. Rate limiting is the common
 * outcome of an unauthenticated call from CI and says nothing about the metadata, so it stays
 * unverifiable. A 404 is the opposite: it is what a renamed repository or a stale `OWNER`
 * returns, and treating it as transient would leave this check green for as long as the
 * mistake lasted, examining no metadata at all.
 */
export function isPermanentStatus(status) {
  if (status === 403 || status === 429) return false; // rate limited, not unreadable
  if (status >= 500) return false; // GitHub's side, and it recovers
  return status >= 400;
}

export async function fetchRepoMetadata(owner = OWNER, repo = REPO) {
  // Unauthenticated on purpose: the repository is public, so this needs no token and runs the
  // same way on a laptop and in CI. A token would make the check pass locally for someone whose
  // gh is logged in and fail in an environment that has none.
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    const error = new Error(`GitHub API returned ${response.status} for ${owner}/${repo}`);
    error.permanent = isPermanentStatus(response.status);
    throw error;
  }
  const body = await response.json();
  return { description: body.description ?? "", topics: body.topics ?? [] };
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
    if (error.permanent) {
      console.error(
        `\nrepo metadata: ${OWNER}/${REPO} could not be read (${error.message})\n\n` +
          `This status does not recover on its own. Either the repository was renamed or made ` +
          `private and the constants in this script are stale, or it can no longer be read ` +
          `without a token.\n`
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
