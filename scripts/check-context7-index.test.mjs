import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  citationFindings,
  citedPaths,
  firstHeading,
  headings,
  LIBRARY,
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

  it("falls back to a line of prose, and reports nothing when every line is shared", () => {
    expect(probeMarker("@AGENTS.md\n", "")).toBe("@AGENTS.md");
    expect(probeMarker("## Setup\n", "## Setup")).toBeNull();
    expect(probeMarker("<p>markup</p>\n- a list\n", "")).toBeNull();
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
    // Every excluded file, CLAUDE.md included: its one line, `@AGENTS.md`, is a
    // sentence the docs do not contain, so even that file can be asked for.
    const unprobeable = config.excludeFiles.filter(
      name => probeMarker(readFileSync(name, "utf-8"), corpus) === null
    );
    expect(unprobeable).toEqual([]);
  });
});

/** What the search endpoint says about the library. */
function searchAnswer({ registered, state }) {
  const results = registered ? [{ id: LIBRARY, state }] : [];
  return { status: 200, body: JSON.stringify({ results }) };
}

/** What a topic query returns: the sentence, when the script says the index has it. */
function topicAnswer(topic, topics) {
  return {
    status: 200,
    body: topics[topic] ? `### x\n\n${topic}\n` : "nothing\n",
  };
}

/**
 * A Context7 that answers from a script.
 *
 * `topics` maps a probed sentence to whether the index "returns" it; anything
 * not listed comes back empty. The real files under the repository root are
 * read for their markers, so the stand-in answers the questions the script
 * really asks.
 */
function context7({
  state = "finalized",
  registered = true,
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
    if (url.includes("/search?")) return searchAnswer({ registered, state });
    const topic = new URL(url).searchParams.get("topic");
    return topic === null
      ? { status: 200, body: dump }
      : topicAnswer(topic, topics);
  };
}

/** The markers the script will ask for, read from the real files. */
function realMarkers() {
  const corpus = readdirSync("docs", { recursive: true })
    .filter(name => String(name).endsWith(".mdx"))
    .map(name => readFileSync(`docs/${name}`, "utf-8"))
    .join("\n");
  const config = JSON.parse(readFileSync("context7.json", "utf-8"));
  return {
    docs: firstHeading(
      readFileSync("docs/getting-started/index.mdx", "utf-8"),
      "docs"
    ),
    readme: probeMarker(readFileSync("README.md", "utf-8"), corpus),
    excluded: Object.fromEntries(
      config.excludeFiles
        .filter(name => existsSync(name))
        .map(name => [name, probeMarker(readFileSync(name, "utf-8"), corpus)])
    ),
  };
}

describe("verify", () => {
  const markers = realMarkers();
  const kept = { [markers.docs]: true, [markers.readme]: true };

  it("passes when the kept files come back and no excluded file does", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: kept }),
    });
    expect(lines.join("\n")).toContain("finalized");
    expect(status).toBe(0);
  });

  it("fails when an excluded file's sentence is retrievable", async () => {
    const [name, marker] = Object.entries(markers.excluded)[0];
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: { ...kept, [marker]: true } }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(`from ${name} is retrievable`);
  });

  it("fails when the README, which the configuration keeps, cannot be retrieved", async () => {
    const { status, lines } = await verify({
      root: ".",
      get: context7({ topics: { [markers.docs]: true } }),
    });
    expect(status).toBe(1);
    expect(lines.join("\n")).toContain(
      "from README.md; an absence would prove nothing"
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
