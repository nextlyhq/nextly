import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  citationFindings,
  citedPaths,
  headings,
  LIBRARY,
  markerFor,
  probeMarker,
  readCorpus,
  REPO_BLOB,
  Unanswerable,
  verify,
  witnesses,
} from "./check-context7-index.mjs";

/** The tracked Markdown, read once for every test that chooses a marker from it. */
const corpus = readCorpus(".");

/** A dump in the shape Context7 returns, measured on /upstash/context7. */
const dump = (...paths) =>
  paths
    .map(
      path => `### A snippet\n\nSource: ${REPO_BLOB}main/${path}\n\nsome text\n`
    )
    .join("\n--------------------------------\n\n");

describe("citedPaths", () => {
  it("reads the path after the ref from every Source line", () => {
    expect([...citedPaths(dump("docs/index.mdx", "README.md"))]).toEqual([
      "docs/index.mdx",
      "README.md",
    ]);
  });

  it("ignores a citation of another repository", () => {
    const text = `Source: https://github.com/upstash/context7/blob/master/docs/x.mdx\n`;
    expect(citedPaths(text).size).toBe(0);
  });

  it("reads nothing from a dump with no citations, which the caller reports", () => {
    expect(citedPaths("no sources here").size).toBe(0);
  });
});

describe("citationFindings", () => {
  const config = { folders: ["docs"], excludeFiles: ["AGENTS.md"] };

  it("is silent when every citation is inside the configuration", () => {
    expect(
      citationFindings(
        new Set(["docs/index.mdx", "docs/a/b.mdx", "README.md"]),
        config
      )
    ).toEqual([]);
  });

  it("reports a file under an excluded folder even when a listed folder holds it", () => {
    // A folder is a path segment: the sibling `docs/internal-notes` shares
    // the prefix and is not under the entry.
    const config = {
      folders: ["docs"],
      excludeFolders: ["docs/internal"],
      excludeFiles: [],
    };
    expect(
      citationFindings(
        new Set(["docs/internal/secret.mdx", "docs/internal-notes/note.mdx"]),
        config
      )
    ).toEqual([
      "docs/internal/secret.mdx is under an excludeFolders entry and was indexed anyway",
    ]);
  });

  it("reports an excluded root file that was indexed anyway", () => {
    expect(
      citationFindings(new Set(["docs/index.mdx", "AGENTS.md"]), config)
    ).toEqual(["AGENTS.md is in excludeFiles and was indexed anyway"]);
  });

  it("reads an excludeFiles entry as a filename, wherever the file sits", () => {
    // Context7 documents the entry as a name, not a path, so a package's
    // AGENTS.md is excluded by the same entry as the root one.
    expect(
      citationFindings(new Set(["packages/nextly/AGENTS.md"]), config)
    ).toEqual([
      "packages/nextly/AGENTS.md is in excludeFiles and was indexed anyway",
    ]);
  });

  it("reports a root file that is neither the README nor excluded", () => {
    // A root file the configuration never named, cited anyway. Context7's
    // default exclusions do not cover it: they apply only to a configuration
    // that names no exclusions of its own.
    expect(citationFindings(new Set(["CHANGELOG.md"]), config)).toEqual([
      'CHANGELOG.md is outside folders ["docs"] and is not the README, and was indexed',
    ]);
  });

  it("reports a file outside the listed folders", () => {
    expect(
      citationFindings(new Set(["packages/nextly/README.md"]), config)
    ).toEqual([
      'packages/nextly/README.md is outside folders ["docs"] and is not the README, and was indexed',
    ]);
  });

  it("reports an empty citation set rather than passing on it", () => {
    expect(citationFindings(new Set(), config)).toHaveLength(1);
  });
});

describe("the committed configuration", () => {
  it("excludes every root Markdown file that is not documentation", () => {
    // The list in context7.json is checked against the files that exist, so a
    // new root file that is not for readers of the product is a failing test
    // rather than a surprise in the index.
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    // Tracked files, not the directory: Context7 indexes what is committed,
    // and a contributor's untracked NOTES.md is not the repository's problem.
    const rootMarkdown = execFileSync("git", ["ls-files", "--", "*.md"], {
      encoding: "utf-8",
    })
      .split("\n")
      .filter(name => name.endsWith(".md") && !name.includes("/"));
    // Nothing is left to Context7's default exclusions: per its documentation
    // they apply only to a configuration that names no exclusions of its own,
    // and this one does, so a LICENSE or CODE_OF_CONDUCT is indexed unless
    // named here.
    const forReaders = new Set(["README.md"]);
    const unaccounted = rootMarkdown.filter(
      name => !config.excludeFiles.includes(name) && !forReaders.has(name)
    );
    expect(unaccounted).toEqual([]);
  });

  it("names its exclusions as filenames, which is what Context7 matches", () => {
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    expect(config.excludeFiles.filter(name => name.includes("/"))).toEqual([]);
  });

  it("keeps the README, which is the one root file meant to be indexed", () => {
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    expect(config.excludeFiles).not.toContain("README.md");
  });

  it("names only files that exist, so a rename cannot leave one indexed", () => {
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    expect(config.excludeFiles.filter(name => !existsSync(name))).toEqual([]);
    expect(config.folders.filter(name => !existsSync(name))).toEqual([]);
  });
});

describe("probeMarker", () => {
  it("takes the first heading nothing else contains", () => {
    const file = "# Title\n\n## Overview\n\n## Repository map\n";
    expect(headings(file)).toEqual(["Title", "Overview", "Repository map"]);
    // "Overview" is a heading a docs page also uses, so probing for it would
    // find the docs and report the exclusion as broken.
    expect(probeMarker(file, ["## Overview\n", "## Title of a page"])).toBe(
      "Repository map"
    );
  });

  it("falls back to a line of prose, and reports nothing when every line is shared", () => {
    expect(probeMarker("@AGENTS.md\n", [])).toBe("@AGENTS.md");
    expect(probeMarker("## Setup\n", ["## Setup"])).toBeNull();
    expect(probeMarker("<p>markup</p>\n- a list\n", [])).toBeNull();
  });

  it("finds a marker of its own in every committed excluded file", () => {
    // The real files against everything else git tracks, so the probe has a
    // sentence no other file the index may hold could answer for. CLAUDE.md
    // is one line, `@AGENTS.md`, and even that is its own.
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    for (const name of config.excludeFiles.filter(name => corpus.has(name))) {
      expect(markerFor(corpus, name), name).toEqual(expect.any(String));
    }
  });

  it("refuses a file git does not track, which the index cannot have read", () => {
    expect(() => markerFor(corpus, "NOTES.md")).toThrow(Unanswerable);
  });

  it("chooses a README sentence no package README shares", () => {
    // "Quickstart" heads the root README and two package READMEs; a probe for
    // it could be answered from either, which is a control that never looked.
    const marker = markerFor(corpus, "README.md");
    for (const other of [
      "packages/nextly/README.md",
      "packages/create-nextly-app/README.md",
    ]) {
      expect(
        readFileSync(other, "utf-8"),
        `${other} shares "${marker}"`
      ).not.toContain(marker);
    }
  });
});

/** What the search endpoint says about the library. */
function searchAnswer({ registered, state, results }) {
  if (results !== undefined)
    return { status: 200, body: JSON.stringify({ results }) };
  return {
    status: 200,
    body: JSON.stringify({
      results: registered ? [{ id: LIBRARY, state }] : [],
    }),
  };
}

/**
 * What a topic query returns: the sentence, cited from the file the script
 * says holds it, or nothing.
 */
function topicAnswer(topic, topics) {
  const from = topics[topic];
  if (!from) return { status: 200, body: "nothing\n" };
  return {
    status: 200,
    body: `### x\n\nSource: ${REPO_BLOB}main/${from}\n\n${topic}\n`,
  };
}

/**
 * A Context7 that answers from a script.
 *
 * `topics` maps a probed sentence to the file the index "cites" it from;
 * anything not listed comes back empty. The real files under the repository
 * root are read for their markers, so the stand-in answers the questions the
 * script really asks.
 */
function context7({
  state = "finalized",
  registered = true,
  results,
  cites = ["docs/index.mdx", "README.md"],
  topics = {},
  statusFor = () => 200,
} = {}) {
  const dump = cites
    .map(path => `Source: ${REPO_BLOB}main/${path}\n`)
    .join("\n");
  return async url => {
    const status = statusFor(url);
    if (status !== 200) return { status, body: "" };
    if (url.includes("/search?"))
      return searchAnswer({ registered, state, results });
    const topic = new URL(url).searchParams.get("topic");
    return topic === null
      ? { status: 200, body: dump }
      : topicAnswer(topic, topics);
  };
}

/** The markers the script will ask for, read from the real files. */
function realMarkers() {
  const config = JSON.parse(readFileSync("context7.json", "utf-8"));
  return {
    docs: markerFor(corpus, "docs/getting-started/index.mdx"),
    readme: markerFor(corpus, "README.md"),
    excluded: Object.fromEntries(
      config.excludeFiles
        .filter(name => corpus.has(name))
        .map(name => [name, markerFor(corpus, name)])
    ),
    witnesses: witnesses(corpus, config),
  };
}

describe("witnesses", () => {
  const files = new Map([
    ["README.md", "# Nextly\n\nThe README, kept.\n"],
    ["CHANGELOG.md", "# Changelog\n\nA root file nothing names.\n"],
    [".changeset/note.md", "A hidden note outside the docs.\n"],
    ["AGENTS.md", "# Agents\n\nThe root agent file.\n"],
    ["packages/nextly/AGENTS.md", "# Agents\n\nThe package agent file.\n"],
    ["docs/index.mdx", "# Overview\n\nA docs page, kept.\n"],
    // A sibling that shares the entry's prefix and sorts before it in git's
    // order: a prefix read without its slash would make it the witness.
    ["docs/internal-notes/note.mdx", "# Overview\n\nA page of the sibling folder, kept.\n"],
    ["docs/internal/shared.mdx", "# Overview\n"],
    ["docs/internal/secret.mdx", "# Overview\n\nA sentence of the internal page.\n"],
    ["docs/private/notes.mdx", "# Overview\n\nThe private page.\n"],
    ["docs/archive/old.mdx", "# Overview\n\nThe archived page.\n"],
    ["apps/playground/CHANGELOG.md", "# playground\n\nThe app's changelog.\n"],
    ["packages/legacy/README.md", "# legacy\n\nA README under a folder Context7 drops on its own.\n"],
    ["packages/nextly/README.md", "# Nextly\n\nThe package README, outside the docs.\n"],
  ]);
  const config = {
    folders: ["docs"],
    excludeFolders: ["docs/internal", "docs/private", "docs/archive", "docs/absent"],
    excludeFiles: ["AGENTS.md"],
  };

  it("chooses one file per excluded set, the first in git's order with a sentence of its own", () => {
    const bySet = (a, b) => a.set.localeCompare(b.set);
    expect(witnesses(files, config).sort(bySet)).toEqual([
      // The root file witnesses the name, before the package's copy.
      {
        set: "excludeFiles entry AGENTS.md",
        name: "AGENTS.md",
        marker: "The root agent file.",
      },
      // `docs/archive` holds only a file Context7's defaults may drop, so that
      // file stands in: absent, the folder is out one way or another; present,
      // the entry did not take.
      {
        set: "excludeFolders entry docs/archive",
        name: "docs/archive/old.mdx",
        marker: "The archived page.",
      },
      // `shared.mdx` has nothing of its own, so the next file of the folder witnesses it.
      {
        set: "excludeFolders entry docs/internal",
        name: "docs/internal/secret.mdx",
        marker: "A sentence of the internal page.",
      },
      {
        set: "excludeFolders entry docs/private",
        name: "docs/private/notes.mdx",
        marker: "The private page.",
      },
      {
        set: 'folders ["docs"]',
        name: "packages/nextly/README.md",
        marker: "The package README, outside the docs.",
      },
    ].sort(bySet));
  });

  it("prefers a file only the rule keeps out over one a crawler might drop anyway", () => {
    // Context7 may skip a hidden path unasked and may drop a CHANGELOG or a
    // `legacy` folder on its own, so such a file's absence could be their
    // doing. All three sort before the package README, so the order alone
    // would pick one of them; the rank does not.
    const names = witnesses(files, config).map(witness => witness.name);
    for (const name of [
      ".changeset/note.md",
      "apps/playground/CHANGELOG.md",
      "packages/legacy/README.md",
    ]) {
      expect(names).not.toContain(name);
    }
  });

  it("never lets a root file witness the folders rule, and probes nothing when only root files are outside", () => {
    // Context7 holds root Markdown whatever `folders` says, so such a file can
    // only ever be retrievable, and naming it in excludeFiles is the fix. It
    // sorts first, so the order alone would pick it.
    expect(witnesses(files, config).map(witness => witness.name)).not.toContain(
      "CHANGELOG.md"
    );
    const onlyRoot = new Map([
      ["README.md", "# Nextly\n\nThe README, kept.\n"],
      ["CHANGELOG.md", "# Changelog\n\nA root file nothing names.\n"],
      ["docs/index.mdx", "# Overview\n\nA docs page, kept.\n"],
    ]);
    expect(witnesses(onlyRoot, { folders: ["docs"] })).toEqual([]);
  });

  it("probes nothing for an excluded folder that holds no tracked file", () => {
    expect(
      witnesses(files, config).map(witness => witness.set)
    ).not.toContain("excludeFolders entry docs/absent");
  });

  it("stops rather than passes when a set offers nothing to ask for", () => {
    const shared = new Map([
      ["docs/index.mdx", "# Overview\n"],
      ["docs/internal/a.mdx", "# Overview\n"],
    ]);
    expect(() =>
      witnesses(shared, { folders: ["docs"], excludeFolders: ["docs/internal"] })
    ).toThrow(Unanswerable);
  });

  it("finds a witness for every set the committed configuration excludes", () => {
    // Every excludeFiles entry is witnessed by its root file, and the folders
    // rule by a file the index would hold without it: not a changeset under
    // `.changeset/`, and not the playground's CHANGELOG, which sorts first.
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    const found = witnesses(corpus, config);
    for (const name of config.excludeFiles) {
      expect(found).toContainEqual(
        expect.objectContaining({ set: `excludeFiles entry ${name}`, name })
      );
    }
    const folders = found.find(witness => witness.set === 'folders ["docs"]');
    expect(folders.name).toContain("/");
    expect(folders.name).not.toMatch(/^\.|changelog/i);
  });
});

describe("verify", () => {
  const markers = realMarkers();
  const kept = {
    [markers.docs]: "docs/getting-started/index.mdx",
    [markers.readme]: "README.md",
  };

  it("passes when the kept files come back cited and no excluded file does", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: kept }),
    });
    expect(lines.join("\n")).toContain("finalized");
    expect(status).toBe(0);
  });

  it("fails when a kept file's sentence comes back cited from somewhere else", async () => {
    // The README's sentence answered from a package README: the marker is
    // present, the root README is not, and the control must not clear.
    const { status, lines } = await verify({
      root: ".",
      get: context7({
        topics: { ...kept, [markers.readme]: "packages/nextly/README.md" },
      }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain("cited from README.md");
  });

  it("fails when an excluded file's sentence is retrievable", async () => {
    const [name, marker] = Object.entries(markers.excluded)[0];
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: { ...kept, [marker]: name } }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(
      `${name} is retrievable ("${marker}" came back, or the file was cited); excludeFiles entry ${name} did not take`
    );
  });

  it("fails when a file outside the listed folders is retrievable", async () => {
    // The folders rule, witnessed by one file it keeps out. The citation
    // sample cannot see this: a file it happens not to cite is not a file
    // the index does not hold.
    const { name, marker } = markers.witnesses.find(
      witness => witness.set === 'folders ["docs"]'
    );
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: { ...kept, [marker]: name } }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(
      `${name} is retrievable ("${marker}" came back, or the file was cited); folders ["docs"] did not take`
    );
  });

  it("fails when the README, which the configuration keeps, cannot be retrieved", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: context7({
        topics: { [markers.docs]: "docs/getting-started/index.mdx" },
      }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(
      "cited from README.md; an absence would prove nothing"
    );
  });

  it("fails when a cited file is one the configuration excludes", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: kept, cites: ["docs/index.mdx", "AGENTS.md"] }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(
      "AGENTS.md is in excludeFiles and was indexed anyway"
    );
  });

  it("cannot answer while the library is unregistered or still indexing", async () => {
    expect(
      (await verify({ root: ".", get: context7({ registered: false }) })).status
    ).toBe(2);
    expect(
      (await verify({ root: ".", get: context7({ state: "initial" }) })).status
    ).toBe(2);
  });

  it("cannot answer when the search results are not a list, or hold a null", async () => {
    expect(
      (await verify({ root: ".", get: context7({ results: {} }) })).status
    ).toBe(2);
    // A null entry is skipped rather than thrown on; the library is then simply absent.
    const { status, lines } = await verify({
      root: ".",
      get: context7({ results: [null] }),
    });
    expect(status).toBe(2);
    expect(lines.join("\n")).toContain("not in Context7's search results");
  });

  it("cannot answer when a probe gets no answer, rather than counting it as absent", async () => {
    // The excluded-file probe answers 500. Read as "not retrievable" it would
    // clear the exclusion; it is the question going unanswered.
    const excludedMarker = Object.values(markers.excluded)[0];
    const { status, lines } = await verify({
      root: ".",
      get: context7({
        topics: kept,
        statusFor: url =>
          decodeURIComponent(url).includes(excludedMarker) ? 500 : 200,
      }),
    });
    expect(status).toBe(2);
    expect(lines.join("\n")).toContain("answered 500");
  });

  it("cannot answer when the search body is not JSON", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: async () => ({ status: 200, body: "<html>rate limited</html>" }),
    });
    expect(status).toBe(2);
    expect(lines.join("\n")).toContain("not JSON");
  });

  it("cannot answer when the transport fails", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: async () => {
        throw new Unanswerable("boom");
      },
    });
    expect(status).toBe(2);
    expect(lines.join("\n")).toContain("cannot answer");
  });
});

describe("when Context7 cannot be reached", () => {
  it("exits 2, never 1, so an outage is not read as a wrong configuration", () => {
    // A port nothing listens on: the fetch rejects before any verdict exists.
    const run = spawnSync(
      process.execPath,
      ["scripts/check-context7-index.mjs"],
      {
        env: { ...process.env, CONTEXT7_API: "http://127.0.0.1:9" },
        encoding: "utf-8",
      }
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("cannot answer");
  });
});
