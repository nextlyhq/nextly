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
  REPO_BLOB,
  Unanswerable,
  verify,
} from "./check-context7-index.mjs";

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
    expect(
      citationFindings(new Set(["docs/internal/secret.mdx"]), {
        folders: ["docs"],
        excludeFolders: ["docs/internal"],
        excludeFiles: [],
      })
    ).toEqual([
      "docs/internal/secret.mdx is under an excludeFolders entry and was indexed anyway",
    ]);
  });

  it("reports an excluded root file that was indexed anyway", () => {
    expect(
      citationFindings(new Set(["docs/index.mdx", "AGENTS.md"]), config)
    ).toEqual(["AGENTS.md is in excludeFiles and was indexed anyway"]);
  });

  it("reports a root file that is neither the README nor excluded", () => {
    // A CHANGELOG Context7's defaults are trusted to drop, cited anyway.
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
    // Excluded by Context7's defaults, per its documentation.
    const defaults = new Set([
      "CHANGELOG.md",
      "LICENSE.md",
      "CODE_OF_CONDUCT.md",
    ]);
    const forReaders = new Set(["README.md"]);
    const unaccounted = rootMarkdown.filter(
      name =>
        !config.excludeFiles.includes(name) &&
        !defaults.has(name) &&
        !forReaders.has(name)
    );
    expect(unaccounted).toEqual([]);
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
    expect(probeMarker(file, "## Overview\n\n## Title of a page")).toBe(
      "Repository map"
    );
  });

  it("falls back to a line of prose, and reports nothing when every line is shared", () => {
    expect(probeMarker("@AGENTS.md\n", "")).toBe("@AGENTS.md");
    expect(probeMarker("## Setup\n", "## Setup")).toBeNull();
    expect(probeMarker("<p>markup</p>\n- a list\n", "")).toBeNull();
  });

  it("finds a marker of its own in every committed excluded file", () => {
    // The real files against everything else git tracks, so the probe has a
    // sentence no other file the index may hold could answer for. CLAUDE.md
    // is one line, `@AGENTS.md`, and even that is its own.
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    for (const name of config.excludeFiles.filter(name => existsSync(name))) {
      expect(markerFor(".", name), name).toEqual(expect.any(String));
    }
  });

  it("chooses a README sentence no package README shares", () => {
    // "Quickstart" heads the root README and two package READMEs; a probe for
    // it could be answered from either, which is a control that never looked.
    const marker = markerFor(".", "README.md");
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
    docs: markerFor(".", "docs/getting-started/index.mdx"),
    readme: markerFor(".", "README.md"),
    excluded: Object.fromEntries(
      config.excludeFiles
        .filter(name => existsSync(name))
        .map(name => [name, markerFor(".", name)])
    ),
  };
}

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
    expect(lines.join("\n")).toContain(`${name} is retrievable`);
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
