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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * The one root file the configuration means to keep.
 *
 * Context7 reads every root Markdown file whatever `folders` says, and the configuration
 * names the rest to exclude them. A cited root file that is neither the README nor named
 * there, such as a CHANGELOG Context7's defaults are trusted to drop, is a file the index
 * holds that the configuration never agreed to.
 */
function isKeptRoot(path) {
  return path === README;
}

function isInside(path, folders) {
  return folders.some(folder => path.startsWith(`${folder}/`));
}

/**
 * The rules a cited path is judged by, first applicable first. An exclusion wins over an
 * inclusion, which is the precedence Context7 documents for `excludeFolders` against
 * `folders`; then a file must sit under a listed folder or be the README.
 */
const CITATION_RULES = [
  [
    (path, config) => listField(config, "excludeFiles").includes(path),
    path => `${path} is in excludeFiles and was indexed anyway`,
  ],
  [
    (path, config) => isInside(path, listField(config, "excludeFolders")),
    path => `${path} is under an excludeFolders entry and was indexed anyway`,
  ],
  [
    (path, config) =>
      !isInside(path, listField(config, "folders")) && !isKeptRoot(path),
    (path, config) =>
      `${path} is outside folders ${JSON.stringify(listField(config, "folders"))} and is not the README, and was indexed`,
  ],
];

/** Why one cited path disagrees with the configuration, or `null`. */
export function citationFinding(path, config) {
  const rule = CITATION_RULES.find(([applies]) => applies(path, config));
  return rule ? rule[1](path, config) : null;
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

/** The Markdown and MDX files git tracks, which is the set Context7 can have read. */
function trackedText(root) {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--", "*.md", "*.mdx", "**/*.md", "**/*.mdx"],
    {
      cwd: root,
      encoding: "utf-8",
    }
  );
  return out.split("\0").filter(Boolean);
}

/**
 * Everything the index may have read APART from one file, concatenated, for deciding
 * which of that file's sentences is its own.
 *
 * A probe returns whatever the index holds for a topic and cannot say which file it came
 * from, so a marker shared with any other file the index may hold would answer for the
 * wrong one: "Quickstart" heads the root README and two package READMEs. Tracked files
 * only, because an untracked note on one checkout is not something Context7 has read.
 */
function corpusExcept(root, name) {
  return trackedText(root)
    .filter(rel => rel !== name)
    .map(rel => readFileSync(join(root, rel), "utf-8"))
    .join("\n");
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
  return {
    found: answer.body.includes(marker),
    cites: citedPaths(answer.body),
  };
}

/** A JSON body, or `Unanswerable`: a truncated or non-JSON answer is no verdict either. */
function parseAnswer(body, what) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Unanswerable(`${what} answered with a body that is not JSON`);
  }
}

/** The search results as a list, or `Unanswerable` when the answer has another shape. */
async function searchResults(get, api) {
  const search = await get(
    `${api}/search?query=${encodeURIComponent("nextly")}`
  );
  if (search.status !== 200)
    throw new Unanswerable(`search answered ${search.status}`);
  const { results } = parseAnswer(search.body, "search");
  if (!Array.isArray(results))
    throw new Unanswerable("search answered without a list of results");
  return results;
}

/** The library's search entry, once it exists and has finished indexing. */
async function finalizedEntry(get, api) {
  const entry = (await searchResults(get, api)).find(
    result => result?.id === LIBRARY
  );
  if (!entry) {
    throw new Unanswerable(
      `${LIBRARY} is not in Context7's search results; register it first`
    );
  }
  if (entry.state !== "finalized")
    throw new Unanswerable(`${LIBRARY} is in state "${entry.state}"`);
  return entry;
}

/** A marker for a file, or `Unanswerable` when the file offers nothing of its own to ask for. */
export function markerFor(root, name) {
  const marker = probeMarker(
    readFileSync(join(root, name), "utf-8"),
    corpusExcept(root, name)
  );
  if (marker === null)
    throw new Unanswerable(`${name} offers no sentence of its own to ask for`);
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
async function keptControls({ root, api, get }) {
  const kept = [DOCS_WITNESS, README].map(name => [
    name,
    markerFor(root, name),
  ]);
  const findings = [];
  for (const [name, marker] of kept) {
    const answer = await retrievable(get, api, marker, name);
    // The sentence must come back AND be cited from the file it was taken from: a
    // marker answered from some other file would be a control that never looked.
    if (answer.found && answer.cites.has(name)) continue;
    findings.push(
      `the index cannot return "${marker}" cited from ${name}; an absence would prove nothing`
    );
  }
  return findings;
}

/**
 * Every excluded file, probed for a sentence of its own. Not a sample of them, and one
 * that offers nothing to ask for stops the run: a "not probed" would read as a pass to
 * whoever only sees the status.
 */
async function exclusionFindings({ root, api, get, config }) {
  const present = listField(config, "excludeFiles").filter(name =>
    existsSync(join(root, name))
  );
  const findings = [];
  for (const name of present) {
    const marker = markerFor(root, name);
    const answer = await retrievable(get, api, marker, name);
    if (!answer.found && !answer.cites.has(name)) continue;
    findings.push(
      `${name} is retrievable ("${marker}" came back, or the file was cited); its exclusion did not take`
    );
  }
  return findings;
}

/** The findings the index earns against the configuration, given a working library. */
async function indexFindings({ root, api, get, config, cited }) {
  const findings = [
    ...citationFindings(cited, config),
    ...(await keptControls({ root, api, get })),
  ];
  if (
    findings.some(finding => finding.includes("an absence would prove nothing"))
  ) {
    return findings;
  }
  return [
    ...findings,
    ...(await exclusionFindings({ root, api, get, config })),
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
