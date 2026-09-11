import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  citationFindings,
  citedPaths,
  firstHeading,
  headings,
  probeMarker,
  REPO_BLOB,
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

  it("reports an excluded root file that was indexed anyway", () => {
    expect(
      citationFindings(new Set(["docs/index.mdx", "AGENTS.md"]), config)
    ).toEqual(["AGENTS.md is in excludeFiles and was indexed anyway"]);
  });

  it("reports a file outside the listed folders", () => {
    expect(
      citationFindings(new Set(["packages/nextly/README.md"]), config)
    ).toEqual([
      'packages/nextly/README.md is outside folders ["docs"] and was indexed',
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
    const rootMarkdown = readdirSync(".").filter(name => name.endsWith(".md"));
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

  it("names only files that exist, so a rename cannot leave one indexed", () => {
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    expect(config.excludeFiles.filter(name => !existsSync(name))).toEqual([]);
    expect(config.folders.filter(name => !existsSync(name))).toEqual([]);
  });
});

describe("firstHeading", () => {
  it("takes the first second-level heading", () => {
    expect(firstHeading("# T\n\ntext\n\n## First\n\n## Second\n", "x")).toBe(
      "First"
    );
  });

  it("refuses a page with none, rather than probing for an empty string", () => {
    expect(() => firstHeading("# T\n\ntext\n", "x")).toThrow(
      /no second-level heading/
    );
  });
});

describe("probeMarker", () => {
  it("takes the first heading the documentation does not contain", () => {
    const file = "# Title\n\n## Overview\n\n## Repository map\n";
    expect(headings(file)).toEqual(["Title", "Overview", "Repository map"]);
    // "Overview" is a heading a docs page also uses, so probing for it would
    // find the docs and report the exclusion as broken.
    expect(probeMarker(file, "## Overview\n\n## Title of a page")).toBe(
      "Repository map"
    );
  });

  it("reports nothing to probe for a file with no unshared heading", () => {
    expect(probeMarker("@AGENTS.md\n", "")).toBeNull();
    expect(probeMarker("## Setup\n", "## Setup")).toBeNull();
  });

  it("finds a marker in every committed excluded file that has headings", () => {
    // The real files against the real docs, so the probe has something to ask
    // for; CLAUDE.md is one line and is the known exception.
    const config = JSON.parse(readFileSync("context7.json", "utf-8"));
    const corpus = readdirSync("docs", { recursive: true })
      .filter(name => String(name).endsWith(".mdx"))
      .map(name => readFileSync(`docs/${name}`, "utf-8"))
      .join("\n");
    expect(corpus.length).toBeGreaterThan(10000);
    const unprobeable = config.excludeFiles.filter(
      name => probeMarker(readFileSync(name, "utf-8"), corpus) === null
    );
    expect(unprobeable).toEqual(["CLAUDE.md"]);
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
