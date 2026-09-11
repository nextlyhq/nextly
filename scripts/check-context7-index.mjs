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
 * a library that is not indexed at all, so the library has to be found and finalized, and
 * a docs sentence and the README's have to be retrievable, before an absence means anything.
 *
 * Exit status: 0 the index agrees with the configuration; 1 it does not; 2 the question
 * could not be answered — not registered yet, still indexing, Context7 unreachable, or a
 * probe that got no answer — which a caller must never read as a pass. Nothing here passes
 * on a question it could not ask.
 *
 * Usage:
 *   node scripts/check-context7-index.mjs
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const LIBRARY = "/nextlyhq/nextly";
/** Overridable so a test can point the script at a port nothing listens on. */
const API = process.env.CONTEXT7_API ?? "https://context7.com/api/v1";
export const REPO_BLOB = "https://github.com/nextlyhq/nextly/blob/";

/** The page whose retrievability proves the index answers for the docs at all. */
const DOCS_WITNESS = "docs/getting-started/index.mdx";
/** Root Markdown the configuration keeps, whose retrievability proves that inclusion. */
const README = "README.md";

/** "I could not answer", as distinct from "the answer is no". */
export class Unanswerable extends Error {}

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

/** Every heading in a file, top-level and second-level, in order. */
export function headings(text) {
  return [...text.matchAll(/^#{1,2}\s+(.+)$/gm)].map(match => match[1].trim());
}

/** Lines of a file that could stand as a marker: prose, not markup, long enough to be one. */
function markerLines(text) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length >= 8 && !/^[<|\-*#`]/.test(line));
}

/**
 * A sentence of a file that no documentation page contains.
 *
 * The probe asks the index for the sentence and reads the answer, so a heading the docs
 * also use would find the docs: "Overview" and "packages" both do. Headings are tried
 * first, then any line of prose, which is what a one-line `CLAUDE.md` has. `null` means
 * the file offers nothing to ask for, and the caller must not read that as a pass.
 */
export function probeMarker(text, corpus) {
  const candidates = [...headings(text), ...markerLines(text)];
  return candidates.find(candidate => !corpus.includes(candidate)) ?? null;
}

/** The documentation, concatenated, for deciding what a marker must not share. */
function docsCorpus(root) {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mdx"))
        out.push(readFileSync(full, "utf-8"));
    }
  };
  walk(join(root, "docs"));
  return out.join("\n");
}

/**
 * Context7's answer, or `Unanswerable`.
 *
 * A rejected fetch (DNS, TLS, a proxy, a dropped connection) is not a verdict about the
 * index. Left to propagate it would exit 1, and a caller would read a Context7 outage as
 * the configuration being wrong.
 */
export async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "text/plain, application/json" },
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    throw new Unanswerable(
      `${url} could not be fetched: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Whether the index returns a sentence for its own topic.
 *
 * A non-200 is not "no": it is the question going unanswered, and it stops the run rather
 * than being counted as an absence that would then clear an exclusion.
 */
async function retrievable(get, api, marker, name) {
  const answer = await get(
    `${api}${LIBRARY}?type=txt&topic=${encodeURIComponent(marker)}&tokens=5000`
  );
  if (answer.status !== 200) {
    throw new Unanswerable(`probing for ${name} answered ${answer.status}`);
  }
  return answer.body.includes(marker);
}

/** The library's search entry, once it exists and has finished indexing. */
async function finalizedEntry(get, api) {
  const search = await get(
    `${api}/search?query=${encodeURIComponent("nextly")}`
  );
  if (search.status !== 200)
    throw new Unanswerable(`search answered ${search.status}`);
  const entry = JSON.parse(search.body).results?.find(
    result => result.id === LIBRARY
  );
  if (!entry) {
    throw new Unanswerable(
      `${LIBRARY} is not in Context7's search results; register it first`
    );
  }
  if (entry.state !== "finalized") {
    throw new Unanswerable(`${LIBRARY} is in state "${entry.state}"`);
  }
  return entry;
}

/** A marker for a file, or `Unanswerable` when the file offers nothing to ask for. */
function markerFor(root, name, corpus) {
  const marker = probeMarker(readFileSync(join(root, name), "utf-8"), corpus);
  if (marker === null)
    throw new Unanswerable(`${name} offers no sentence to ask for`);
  return marker;
}

/**
 * Whether what the configuration keeps comes back for its own topic.
 *
 * A docs page and the README. Each is a positive control for every absence the exclusion
 * probes report, and the README's is also the only way to see root Markdown was kept,
 * since the citation sample cannot. A control that fails is a finding, and the exclusions
 * are then not probed at all: their absences would prove nothing.
 */
async function keptControls({ root, api, get, corpus }) {
  const kept = [
    [
      DOCS_WITNESS,
      firstHeading(
        readFileSync(join(root, DOCS_WITNESS), "utf-8"),
        DOCS_WITNESS
      ),
    ],
    [README, markerFor(root, README, corpus)],
  ];
  const findings = [];
  for (const [name, marker] of kept) {
    if (await retrievable(get, api, marker, name)) continue;
    findings.push(
      `the index cannot return "${marker}" from ${name}; an absence would prove nothing`
    );
  }
  return findings;
}

/**
 * Every excluded file, probed for a sentence of its own. Not a sample of them, and one
 * that offers nothing to ask for stops the run: a "not probed" would read as a pass to
 * whoever only sees the status.
 */
async function exclusionFindings({ root, api, get, config, corpus }) {
  const findings = [];
  for (const name of listField(config, "excludeFiles")) {
    if (!existsSync(join(root, name))) continue;
    const marker = markerFor(root, name, corpus);
    if (await retrievable(get, api, marker, name)) {
      findings.push(
        `"${marker}" from ${name} is retrievable; its exclusion did not take`
      );
    }
  }
  return findings;
}

/** The findings the index earns against the configuration, given a working library. */
async function indexFindings({ root, api, get, config, cited }) {
  const corpus = docsCorpus(root);
  const findings = [
    ...citationFindings(cited, config),
    ...(await keptControls({ root, api, get, corpus })),
  ];
  if (
    findings.some(finding => finding.includes("an absence would prove nothing"))
  ) {
    return findings;
  }
  return [
    ...findings,
    ...(await exclusionFindings({ root, api, get, config, corpus })),
  ];
}

/** The status and the lines to print, from what the index earned. */
function report(cited, findings) {
  if (findings.length > 0) {
    return {
      status: 1,
      lines: [
        `check-context7-index: ${findings.length} finding(s) against ${cited.size} sampled citation(s)`,
        ...findings.map(finding => `  - ${finding}`),
      ],
    };
  }
  return {
    status: 0,
    lines: [
      `check-context7-index: ${LIBRARY} finalized; ${cited.size} sampled citation(s) all inside the configuration; docs and README retrievable, no excluded file's sentence is.`,
    ],
  };
}

/**
 * The verdict, as a status and the lines to print.
 *
 * `get` is injectable so a test can stand in for Context7 with scripted answers and hold
 * every branch of the judgement, including the ones only an outage or a misindexing
 * would reach.
 */
export async function verify({ root, api = API, get = fetchText }) {
  try {
    const config = JSON.parse(
      readFileSync(join(root, "context7.json"), "utf-8")
    );
    await finalizedEntry(get, api);

    // The citation dump is one capped response and the documentation is larger than it,
    // so it is a sample; the exclusions are probed one by one rather than read off it.
    const dump = await get(`${api}${LIBRARY}?type=txt&tokens=50000`);
    if (dump.status !== 200)
      throw new Unanswerable(`${LIBRARY} answered ${dump.status}`);
    const cited = citedPaths(dump.body);

    return report(
      cited,
      await indexFindings({ root, api, get, config, cited })
    );
  } catch (error) {
    if (error instanceof Unanswerable) {
      return {
        status: 2,
        lines: [`check-context7-index: cannot answer — ${error.message}`],
      };
    }
    throw error;
  }
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("check-context7-index.mjs");

if (invokedDirectly) {
  const { status, lines } = await verify({ root: process.cwd() });
  const out = status === 0 ? console.log : console.error;
  for (const line of lines) out(line);
  process.exit(status);
}
