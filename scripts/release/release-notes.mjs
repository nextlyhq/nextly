// Builds the body of the consolidated GitHub Release for a lockstep train.
//
// Every publishable package shares one version through the Changesets `fixed`
// group, so a single changeset is written verbatim into every changelog it
// covers. Concatenating whole changelog sections therefore repeats the same
// human-authored prose once per package and adds a block of generated
// "Updated dependencies" bumps on top of it, which is how a release body
// reached 349k characters against GitHub's 125,000-character ceiling and
// failed the release step outright.
//
// The notes are instead the union of the distinct entries across the train:
// each changeset appears once, dependency bumps are dropped, and the result is
// capped below the API limit so long notes are truncated rather than fatal.
//
// Usage: node scripts/release/release-notes.mjs [--version <semver>]
//                                               [--max-length <chars>]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getReleaseManifest, REPO_ROOT } from "./lib.mjs";

// GitHub rejects a release body over 125,000 characters with a 422. Sitting on
// the exact limit leaves no room for the truncation marker itself, so cap lower
// and let the marker fit inside the remaining margin.
export const MAX_BODY_LENGTH = 120000;

/** Change-type headings in the order a reader expects to meet them. */
const HEADING_ORDER = ["Major Changes", "Minor Changes", "Patch Changes"];

/**
 * The body of one version's section of a changelog: everything between
 * `## <version>` and the next `## ` heading. Returns an empty string when the
 * version has no section, which is the normal state for a package that was not
 * part of that train.
 */
export function extractVersionSection(changelog, version) {
  const wanted = `## ${version}`;
  const lines = changelog.split("\n");
  const collected = [];
  let inside = false;

  for (const line of lines) {
    if (!inside) {
      if (line.trim() === wanted) inside = true;
      continue;
    }
    if (line.startsWith("## ")) break;
    collected.push(line);
  }

  return collected.join("\n").trim();
}

/**
 * Splits a changelog section into its individual entries, each tagged with the
 * change-type heading it sits under.
 *
 * An entry starts at a top-level `- ` bullet and runs until the next one, so
 * the indented continuation lines of a multi-paragraph changeset stay attached
 * to it. Nested bullets (the `  - pkg@version` lines a dependency bump writes)
 * are indented and therefore never start a new entry, which is what keeps a
 * genuine entry sitting directly after one from being swallowed or split.
 */
export function parseChangelogSection(section) {
  const entries = [];
  let heading = null;
  let current = null;

  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").replace(/\s+$/, "");
    if (text.length > 0) entries.push({ heading: current.heading, text });
    current = null;
  };

  for (const line of section.split("\n")) {
    const headingMatch = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flush();
      heading = headingMatch[1];
      continue;
    }

    if (line.startsWith("- ")) {
      flush();
      current = { heading, lines: [line] };
      continue;
    }

    if (current) current.lines.push(line);
  }

  flush();
  return entries;
}

/**
 * Whether an entry is a generated dependency bump rather than authored prose.
 *
 * Changesets writes one of these into every package in the fixed group on every
 * train, listing the sibling versions that moved. In a lockstep repo that is
 * always "all of them", so the block carries no information and accounts for
 * most of the volume. The prefix is only honoured at the very start of the
 * entry so prose that merely mentions updating dependencies is kept.
 */
export function isDependencyBumpEntry(text) {
  return /^-\s+Updated dependencies\b/.test(text);
}

/** Comparison key that ignores whitespace differences between changelog copies. */
function dedupeKey(heading, text) {
  return `${heading ?? ""}\n${text.replace(/\s+/g, " ").trim()}`;
}

/**
 * The distinct authored entries across every package in the train, in
 * first-seen order. Packages sharing a changeset produce byte-identical
 * entries, so the first copy encountered stands for all of them.
 */
export function collectUniqueEntries(packages, version) {
  const seen = new Set();
  const entries = [];

  for (const pkg of packages) {
    const section = extractVersionSection(pkg.changelog ?? "", version);
    if (!section) continue;

    for (const entry of parseChangelogSection(section)) {
      if (isDependencyBumpEntry(entry.text)) continue;

      const key = dedupeKey(entry.heading, entry.text);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return entries;
}

/** Groups entries under their change-type heading, known headings first. */
function groupByHeading(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const heading = entry.heading ?? "Changes";
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(entry.text);
  }

  return [...groups.entries()].sort((a, b) => {
    const rankA = HEADING_ORDER.indexOf(a[0]);
    const rankB = HEADING_ORDER.indexOf(b[0]);
    if (rankA === rankB) return 0;
    if (rankA === -1) return 1;
    if (rankB === -1) return -1;
    return rankA - rankB;
  });
}

/**
 * Trims a body to `maxLength` at a block boundary, appending `marker` so the
 * reader knows detail is missing.
 *
 * `tail` is the part of the body that must outlive truncation, so its rendered
 * size and the separator that attaches it are reserved out of the budget before
 * a single `block` is measured. Dropping blocks from the end without that
 * reservation would take the tail with them, since it sits after every block
 * that can be dropped.
 *
 * The final hard slice is a backstop for the degenerate case where the marker
 * and the tail together already exceed the whole budget: the step must never
 * hand GitHub a body it will reject, and a bounded slice terminates where
 * shedding more blocks cannot.
 */
function fitWithinLimit(blocks, tail, marker, maxLength) {
  const separator = "\n\n";
  const joined = [...blocks, ...tail].join(separator);
  if (joined.length <= maxLength) return joined;

  const tailText = tail.join(separator);
  const reserved =
    tailText.length === 0 ? 0 : tailText.length + separator.length;
  const budget = maxLength - reserved - marker.length - separator.length;
  const kept = [];
  let used = 0;

  for (const block of blocks) {
    const cost =
      kept.length === 0 ? block.length : block.length + separator.length;
    if (used + cost > budget) break;
    kept.push(block);
    used += cost;
  }

  const truncated = [
    ...kept,
    marker,
    ...(tailText.length === 0 ? [] : [tailText]),
  ].join(separator);
  return truncated.length <= maxLength
    ? truncated
    : truncated.slice(0, maxLength);
}

/**
 * The release body for one lockstep version.
 *
 * `packages` are `{ name, changelog }` pairs taken from the release manifest,
 * not from the publish step's output: a recovery run publishes only the
 * stragglers, and notes built from that would describe a three-package release.
 */
export function buildReleaseNotes({
  version,
  packages,
  repoUrl,
  maxLength = MAX_BODY_LENGTH,
}) {
  const tag = `v${version}`;
  const tagUrl = `${repoUrl}/tree/${tag}`;
  const entries = collectUniqueEntries(packages, version);

  const blocks = [
    `Released ${packages.length} packages at \`${version}\` in lockstep. ` +
      `Every package below ships at this version.`,
    "## What's changed",
  ];

  if (entries.length === 0) {
    blocks.push(
      `No changelog entries were recorded for \`${version}\`. ` +
        `See the \`CHANGELOG.md\` files at [${tag}](${tagUrl}).`
    );
  } else {
    for (const [heading, texts] of groupByHeading(entries)) {
      blocks.push(`### ${heading}`);
      blocks.push(...texts);
    }
  }

  // The inventory is the one section a reader cannot rebuild from the entries,
  // and the intro promises it, so it is held apart from the blocks truncation
  // may drop and is instead reserved out of the budget.
  const tail = [
    "## Packages",
    packages.map(pkg => `- \`${pkg.name}\``).join("\n"),
  ];

  const marker =
    `> Notes truncated to stay within GitHub's release body limit. ` +
    `The complete changelog for every package is in its \`CHANGELOG.md\` at ` +
    `[${tag}](${tagUrl}).`;

  return fitWithinLimit(blocks, tail, marker, maxLength);
}

/**
 * Repository the tag links should point at. Actions supplies
 * `GITHUB_REPOSITORY`; the Changesets changelog config carries the same value
 * for local runs, so neither path hardcodes the slug.
 */
function resolveRepoUrl() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv) return `https://github.com/${fromEnv}`;

  const configPath = join(REPO_ROOT, ".changeset", "config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const repo = Array.isArray(config.changelog)
      ? config.changelog[1]?.repo
      : undefined;
    if (repo) return `https://github.com/${repo}`;
  }

  throw new Error(
    "cannot resolve the repository: set GITHUB_REPOSITORY or add changelog.repo to .changeset/config.json"
  );
}

/** Reads a flag's value from argv, or `undefined` when it is absent. */
function readOption(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function main() {
  const argv = process.argv.slice(2);
  const manifest = getReleaseManifest();

  if (manifest.length === 0) {
    throw new Error("release manifest is empty: nothing to write notes for");
  }

  const version = readOption(argv, "--version") ?? manifest[0].version;

  const rawMaxLength = readOption(argv, "--max-length");
  const maxLength =
    rawMaxLength === undefined ? MAX_BODY_LENGTH : Number(rawMaxLength);
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new Error(
      `--max-length must be a positive integer, got ${rawMaxLength}`
    );
  }

  const packages = manifest.map(entry => {
    const changelogPath = join(entry.dir, "CHANGELOG.md");
    return {
      name: entry.name,
      changelog: existsSync(changelogPath)
        ? readFileSync(changelogPath, "utf8")
        : "",
    };
  });

  process.stdout.write(
    `${buildReleaseNotes({
      version,
      packages,
      repoUrl: resolveRepoUrl(),
      maxLength,
    })}\n`
  );
}

// Only run when invoked directly, so the exported helpers stay importable from
// tests without producing output.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`release notes failed: ${error.message}`);
    process.exit(1);
  }
}
