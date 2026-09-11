#!/usr/bin/env node

/**
 * What Context7 actually indexed, read back from Context7.
 *
 * `context7.json` says what to index. Context7's own documentation says two things that
 * make the file insufficient on its own: root-level Markdown is always included whatever
 * `folders` says, and the index is rebuilt on its schedule rather than on a push. So the
 * configuration is a request, and this reads the answer: which files the index cites, and
 * whether a sentence from a file the configuration excludes can be retrieved from it.
 *
 * Every assertion here is POSITIVE first. "No AGENTS.md content came back" is satisfied by
 * a library that is not indexed at all, so the library has to be found and finalized, and a
 * docs sentence has to be retrievable, before an absence means anything.
 *
 * Exit status: 0 the index agrees with the configuration; 1 it does not; 2 the question
 * could not be answered — not registered yet, still indexing, or Context7 unreachable —
 * which a caller must never read as a pass.
 *
 * Usage:
 *   node scripts/check-context7-index.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LIBRARY = "/nextlyhq/nextly";
const API = "https://context7.com/api/v1";
export const REPO_BLOB = "https://github.com/nextlyhq/nextly/blob/";

/**
 * The repository paths an index dump cites.
 *
 * Context7 prefixes each snippet with `Source: <blob url>`; the path is what follows the
 * ref, whichever branch it read. A citation of another repository is not this index's
 * business and is skipped.
 */
export function citedPaths(text) {
  const cited = new Set();
  for (const match of text.matchAll(/^Source:\s+(\S+)/gm)) {
    const url = match[1];
    if (!url.startsWith(REPO_BLOB)) continue;
    const path = url.slice(REPO_BLOB.length).split("/").slice(1).join("/");
    if (path) cited.add(path);
  }
  return cited;
}

/** A list field of the configuration, or none. */
function listField(config, name) {
  return Array.isArray(config[name]) ? config[name] : [];
}

/** Root-level Markdown, which Context7 reads whatever `folders` says. */
function isRootMarkdown(path) {
  return !path.includes("/") && path.endsWith(".md");
}

function isInside(path, folders) {
  return folders.some(folder => path.startsWith(`${folder}/`));
}

/**
 * Why one cited path disagrees with the configuration, or `null`.
 *
 * A root-level Markdown file is allowed unless `excludeFiles` names it, which is the rule
 * Context7 documents; anything else must sit under a listed folder.
 */
export function citationFinding(path, config) {
  const folders = listField(config, "folders");
  if (listField(config, "excludeFiles").includes(path)) {
    return `${path} is in excludeFiles and was indexed anyway`;
  }
  if (isInside(path, folders) || isRootMarkdown(path)) return null;
  return `${path} is outside folders ${JSON.stringify(folders)} and was indexed`;
}

/**
 * Where the cited files disagree with the configuration.
 *
 * An empty citation set is itself a finding: it means nothing else was checked.
 */
export function citationFindings(cited, config) {
  if (cited.size === 0) {
    return [
      "the index cites no file from this repository, so nothing else could be checked",
    ];
  }
  return [...cited].map(path => citationFinding(path, config)).filter(Boolean);
}

/**
 * A sentence the index must be able to return, taken from the file rather than written
 * here, so a rewrite of the page cannot leave this comparing against words that no longer
 * exist. The first second-level heading is specific enough to belong to one page.
 */
export function firstHeading(text, name) {
  const match = /^##\s+(.+)$/m.exec(text);
  if (!match)
    throw new Error(`${name}: no second-level heading to use as a marker`);
  return match[1].trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: "text/plain, application/json" },
  });
  return { status: response.status, body: await response.text() };
}

function unanswerable(message) {
  console.error(`check-context7-index: cannot answer — ${message}`);
  process.exit(2);
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-context7-index.mjs");

if (invokedDirectly) {
  const root = process.cwd();
  const config = JSON.parse(readFileSync(join(root, "context7.json"), "utf-8"));

  // 1. The library exists and has finished indexing.
  const search = await fetchText(
    `${API}/search?query=${encodeURIComponent("nextly")}`
  );
  if (search.status !== 200) unanswerable(`search answered ${search.status}`);
  const entry = JSON.parse(search.body).results?.find(
    result => result.id === LIBRARY
  );
  if (!entry)
    unanswerable(
      `${LIBRARY} is not in Context7's search results; register it first`
    );
  if (entry.state !== "finalized")
    unanswerable(`${LIBRARY} is in state "${entry.state}"`);

  // 2. Pull as much of the index as one request returns, and read what it cites.
  const dump = await fetchText(`${API}${LIBRARY}?type=txt&tokens=50000`);
  if (dump.status !== 200) unanswerable(`${LIBRARY} answered ${dump.status}`);
  const cited = citedPaths(dump.body);
  const findings = citationFindings(cited, config);

  // 3. A docs sentence comes back for its own topic; an excluded file's does not. The
  //    positive half comes first, because the negative half proves nothing without it.
  const docsMarker = firstHeading(
    readFileSync(join(root, "docs", "getting-started", "index.mdx"), "utf-8"),
    "docs/getting-started/index.mdx"
  );
  const docsAnswer = await fetchText(
    `${API}${LIBRARY}?type=txt&topic=${encodeURIComponent(docsMarker)}&tokens=5000`
  );
  if (docsAnswer.status !== 200 || !docsAnswer.body.includes(docsMarker)) {
    findings.push(
      `the index cannot return "${docsMarker}" from docs/getting-started/index.mdx, so an absence would prove nothing`
    );
  } else {
    const agentsMarker = firstHeading(
      readFileSync(join(root, "AGENTS.md"), "utf-8"),
      "AGENTS.md"
    );
    const agentsAnswer = await fetchText(
      `${API}${LIBRARY}?type=txt&topic=${encodeURIComponent(agentsMarker)}&tokens=5000`
    );
    if (
      agentsAnswer.status === 200 &&
      agentsAnswer.body.includes(agentsMarker)
    ) {
      findings.push(
        `"${agentsMarker}" from AGENTS.md is retrievable; the exclusion did not take`
      );
    }
  }

  if (findings.length > 0) {
    console.error(
      `check-context7-index: ${findings.length} finding(s) against ${cited.size} cited file(s)`
    );
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log(
    `check-context7-index: ${LIBRARY} finalized; ${cited.size} cited file(s) all inside the configuration; docs retrievable, AGENTS.md not.`
  );
}
