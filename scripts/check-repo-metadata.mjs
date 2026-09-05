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

import { RETIRED_CATEGORY } from "./check-docs-claims.mjs";

const OWNER = "nextlyhq";
const REPO = "nextly";

/**
 * Topics that describe the retired category, and topics the search descriptor commits to.
 *
 * `framework` sits in the forbidden list beside `app-framework` because it is the word the
 * whole repositioning turned on: it could mean an application framework, a UI framework or a
 * backend framework, which is why it was the least informative word available in the title tag.
 */
const FORBIDDEN_TOPICS = ["app-framework", "framework"];
const REQUIRED_TOPICS = [
  "cms",
  "headless-cms",
  "page-builder",
  "nextjs",
  "content-platform",
];

/** The package whose description the About line must match. The root manifest has none. */
const DESCRIPTION_SOURCE = "packages/nextly/package.json";

export async function fetchRepoMetadata(owner = OWNER, repo = REPO) {
  // Unauthenticated on purpose: the repository is public, so this needs no token and runs the
  // same way on a laptop and in CI. A token would make the check pass locally for someone whose
  // gh is logged in and fail in an environment that has none.
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const body = await response.json();
  return { description: body.description ?? "", topics: body.topics ?? [] };
}

export function checkRepoMetadata({ metadata, expectedDescription }) {
  const findings = [];
  const { description, topics } = metadata;

  if (RETIRED_CATEGORY.test(description)) {
    findings.push({
      check: "about-retired-category",
      message: `the GitHub About line still names the retired category: "${description}"`,
    });
  }

  if (expectedDescription && description !== expectedDescription) {
    findings.push({
      check: "about-matches-package",
      message:
        `the GitHub About line differs from ${DESCRIPTION_SOURCE}. ` +
        `About: "${description}" — package: "${expectedDescription}"`,
    });
  }

  for (const topic of FORBIDDEN_TOPICS) {
    if (topics.includes(topic)) {
      findings.push({
        check: "topic-forbidden",
        message: `the topic "${topic}" describes the retired category and should be removed`,
      });
    }
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
  const expectedDescription = JSON.parse(
    readFileSync(join(process.cwd(), DESCRIPTION_SOURCE), "utf-8")
  ).description;

  let metadata;
  try {
    metadata = await fetchRepoMetadata();
  } catch (error) {
    // Unverifiable, not failed. An unreachable API says nothing about the metadata, and a check
    // that goes red when the network is down teaches people to wave this one through.
    console.warn(
      `repo metadata: could not be read (${error.message}). Not counted as a failure.`
    );
    process.exit(0);
  }

  const { findings } = checkRepoMetadata({ metadata, expectedDescription });

  if (findings.length === 0) {
    console.log("repo metadata: About line and topics agree with the category.");
    process.exit(0);
  }

  console.error(`\nrepo metadata: ${findings.length} finding(s)\n`);
  for (const finding of findings) {
    console.error(`  ${finding.check}: ${finding.message}`);
  }
  console.error(
    `\nThese are repository settings, not files. Fix them in Settings on GitHub, ` +
      `or with:\n  gh repo edit ${OWNER}/${REPO} --description "..." --add-topic ... --remove-topic ...\n`
  );
  process.exit(1);
}
