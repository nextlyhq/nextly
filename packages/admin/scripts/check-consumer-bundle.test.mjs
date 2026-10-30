/**
 * The consumer-build check, against output modelled for each case it must
 * report and for a build it must let through.
 *
 * Two halves. The reader is given a chunk written the way Turbopack writes
 * one, with a source map encoded here, and must find each factory, the
 * modules its code maps to and what a loader fetches. The verdict is given a
 * package graph and an output, built from a passing pair by changing one
 * thing, and must name the kind each change breaks; every refusing case names
 * its kind, so a case that failed for another reason does not pass here.
 *
 * A real Turbopack build is not a fixture: `check:consumer-bundle` builds one.
 */
import { describe, expect, it } from "vitest";

import {
  LEXICAL_DEVELOPMENT_TEXTS,
  LEXICAL_PRODUCTION_TEXT,
  consumerFindings,
  mappedSegments,
  readChunk,
} from "./check-consumer-bundle.mjs";

// ---------------------------------------------------------------------------
// Source maps written here
// ---------------------------------------------------------------------------

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value) {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

/**
 * A source map placing a segment at each `[offset, source]` of `code`, every
 * one mapped to line 0, column 0 of its source.
 */
function mapFor(code, sources, placed) {
  const lineStarts = [0];
  for (let at = 0; at < code.length; at++) {
    if (code[at] === "\n") lineStarts.push(at + 1);
  }
  const lines = lineStarts.map(() => []);
  for (const [at, source] of [...placed].sort((a, b) => a[0] - b[0])) {
    const line = lineStarts.findLastIndex(start => start <= at);
    lines[line].push({ column: at - lineStarts[line], source });
  }
  let previousSource = 0;
  const mappings = lines
    .map(segments => {
      let previousColumn = 0;
      return segments
        .map(({ column, source }) => {
          const fields = [
            column - previousColumn,
            source - previousSource,
            0,
            0,
          ];
          previousColumn = column;
          previousSource = source;
          return fields.map(vlq).join("");
        })
        .join(",");
    })
    .join(";");
  return { version: 3, sources, names: [], mappings };
}

/** The offset of each occurrence of `text` in `code`. */
function offsetsOf(code, text) {
  const found = [];
  for (
    let at = code.indexOf(text);
    at !== -1;
    at = code.indexOf(text, at + 1)
  ) {
    found.push(at);
  }
  return found;
}

/** How a chunk starts registering its modules; the script it names first is not read. */
const PUSH = "(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([void 0,";

describe("mappedSegments", () => {
  it("places each segment at its offset into the code, across lines", () => {
    const code = "ab\ncdé\nfg";
    const map = mapFor(
      code,
      ["one", "two"],
      [
        [1, 0],
        [4, 1],
        [8, 0],
      ]
    );
    expect(mappedSegments(code, map)).toEqual([
      { at: 1, source: 0 },
      { at: 4, source: 1 },
      { at: 8, source: 0 },
    ]);
  });
});

describe("readChunk", () => {
  const code =
    `${PUSH}11,e=>{let alpha=1;let beta=2;e.s(["a",0,alpha])},` +
    `[12,13,e=>{var t=e.i(11);let gamma=3;let delta=4}],` +
    `14,e=>{e.v(t=>Promise.all(["static/chunks/b.js","static/chunks/c.js"].map(t=>e.l(t))).then(()=>t(12)))}]);`;
  const sources = [
    "turbopack:///[project]/app/node_modules/@nextlyhq/admin/dist/a-AAAAAAAA.mjs",
    "turbopack:///[project]/app/node_modules/@nextlyhq/admin/dist/b-BBBBBBBB.mjs",
  ];
  const placed = [
    ...offsetsOf(code, "alpha").map(at => [at, 0]),
    ...offsetsOf(code, "beta").map(at => [at, 0]),
    // One segment of a's carried into the next factory, onto its import binding.
    [code.indexOf("var t"), 0],
    ...offsetsOf(code, "gamma").map(at => [at, 1]),
    ...offsetsOf(code, "delta").map(at => [at, 1]),
  ];
  const chunk = readChunk(
    "static/chunks/a.js",
    code,
    mapFor(code, sources, placed)
  );

  it("reads each factory under the ids it is registered by", () => {
    expect(chunk.factories.map(factory => factory.ids)).toEqual([
      [11],
      [12, 13],
      [14],
    ]);
  });

  it("names the sources a factory's code maps to, project-relative", () => {
    expect([...chunk.factories[0].sources]).toEqual([
      "app/node_modules/@nextlyhq/admin/dist/a-AAAAAAAA.mjs",
    ]);
    expect([...chunk.sources].sort()).toEqual([
      "app/node_modules/@nextlyhq/admin/dist/a-AAAAAAAA.mjs",
      "app/node_modules/@nextlyhq/admin/dist/b-BBBBBBBB.mjs",
    ]);
  });

  it("does not place a module in a factory by a lone segment", () => {
    expect([...chunk.factories[1].sources]).toEqual([
      "app/node_modules/@nextlyhq/admin/dist/b-BBBBBBBB.mjs",
    ]);
  });

  it("reads what a loader fetches and the module it runs", () => {
    expect(chunk.factories[2].loader).toEqual({
      chunks: ["static/chunks/b.js", "static/chunks/c.js"],
      target: 12,
    });
    expect(chunk.factories[0].loader).toBeNull();
  });

  it("reads a chunk that registers no modules as holding none", () => {
    const runtime = readChunk(
      "static/chunks/runtime.js",
      "(()=>{self.x=1})();",
      null
    );
    expect(runtime.factories).toEqual([]);
  });

  it("refuses a chunk that registers modules with no map to name them", () => {
    expect(() => readChunk("static/chunks/a.js", code, null)).toThrow(
      /no source map/
    );
  });
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const ADMIN = "app/node_modules/@nextlyhq/admin";
const PLUGIN = "app/src/plugin/page.jsx";
const ROUTE = "/admin/[[...params]]";
const src = module => `${ADMIN}/dist/${module}`;

function chunk(name, factories, code = "") {
  return {
    name,
    factories,
    sources: new Set(factories.flatMap(factory => [...factory.sources])),
    code,
  };
}

function factory(ids, sources, loader = null) {
  return { ids, sources: new Set(sources), loader };
}

/**
 * A package with a shell of two modules and two pages that share a helper,
 * and an output that keeps all of it apart: the first load holds the shell,
 * the plugin page and a loader for each page, which fetches the page and the
 * shared helper.
 */
function passing() {
  const shell = ["index.mjs", "shared-SSSSSSSS.mjs"];
  const pkg = {
    shell: new Set(shell),
    routes: [
      {
        root: "page.a-AAAAAAAA.mjs",
        uses: new Set([...shell, "page.a-AAAAAAAA.mjs", "both-BBBBBBBB.mjs"]),
      },
      {
        root: "page.b-CCCCCCCC.mjs",
        uses: new Set([...shell, "page.b-CCCCCCCC.mjs", "both-BBBBBBBB.mjs"]),
      },
    ],
    modules: new Set([
      ...shell,
      "page.a-AAAAAAAA.mjs",
      "page.b-CCCCCCCC.mjs",
      "both-BBBBBBBB.mjs",
    ]),
  };
  const output = {
    chunks: new Map(
      [
        chunk("static/chunks/shell.js", [
          factory([1], [src("index.mjs")]),
          factory([2], [src("shared-SSSSSSSS.mjs")]),
          factory([3], [PLUGIN]),
          factory([4], [], {
            chunks: ["static/chunks/a.js", "static/chunks/both.js"],
            target: 10,
          }),
          factory([5], [], {
            chunks: ["static/chunks/b.js", "static/chunks/both.js"],
            target: 20,
          }),
        ]),
        chunk("static/chunks/a.js", [
          factory([10], [src("page.a-AAAAAAAA.mjs")]),
        ]),
        chunk("static/chunks/b.js", [
          factory([20], [src("page.b-CCCCCCCC.mjs")]),
        ]),
        chunk("static/chunks/both.js", [
          factory([30], [src("both-BBBBBBBB.mjs")]),
        ]),
        chunk("static/chunks/editor.js", [], `x("${LEXICAL_PRODUCTION_TEXT}")`),
      ].map(c => [c.name, c])
    ),
    firstLoads: new Map([[ROUTE, ["static/chunks/shell.js"]]]),
  };
  return {
    pkg,
    output,
    adminDir: ADMIN,
    pluginPage: PLUGIN,
    pinned: ["page.a", "page.b"],
  };
}

function kinds(input) {
  return consumerFindings(input).problems.map(problem => problem.kind);
}

/** Adds a factory, and the sources it holds, to one chunk of the output. */
function addFactory(input, name, ids, sources) {
  const target = input.output.chunks.get(name);
  target.factories.push(factory(ids, sources));
  for (const source of sources) target.sources.add(source);
}

describe("consumerFindings", () => {
  it("passes an output that keeps the shell and each route apart", () => {
    const result = consumerFindings(passing());
    expect(result.problems).toEqual([]);
    expect(result.counts).toMatchObject({
      onDemand: 2,
      pieces: 2,
      pinned: 2,
      shell: 2,
      modules: 5,
    });
    expect(result.routeNames).toEqual(["page.a", "page.b"]);
  });

  it("reports route code in the first load, naming whose code it is", () => {
    const input = passing();
    addFactory(
      input,
      "static/chunks/shell.js",
      [40],
      [src("page.a-AAAAAAAA.mjs")]
    );
    const { problems } = consumerFindings(input);
    const found = problems.find(p => p.kind === "shell-loads-route-code");
    expect(found?.message).toMatch(
      /holds page\.a-AAAAAAAA\.mjs.*code of page\.a/
    );
  });

  it("reports a pinned route nothing loads on demand", () => {
    const input = passing();
    input.output.chunks.get("static/chunks/shell.js").factories.splice(3, 1);
    expect(kinds(input)).toEqual(["route-not-on-demand"]);
  });

  it("reports a pinned route the package no longer splits off", () => {
    const input = passing();
    input.pinned = [...input.pinned, "page.gone"];
    expect(kinds(input)).toEqual(["route-not-on-demand"]);
  });

  it("reports a route whose loader fetches another route's code", () => {
    const input = passing();
    addFactory(input, "static/chunks/b.js", [41], [src("page.a-AAAAAAAA.mjs")]);
    expect(kinds(input)).toContain("route-loads-foreign-code");
  });

  it("reports a module a direct visit fetches in two chunks", () => {
    const input = passing();
    addFactory(input, "static/chunks/b.js", [30], [src("both-BBBBBBBB.mjs")]);
    expect(kinds(input)).toEqual(["fetched-twice"]);
  });

  it("reports a module whose code sits in two modules of the output", () => {
    const input = passing();
    addFactory(
      input,
      "static/chunks/editor.js",
      [42],
      [src("shared-SSSSSSSS.mjs")]
    );
    expect(kinds(input)).toEqual(["module-runs-twice"]);
  });

  it("measures, and does not report, one module copied into two chunks", () => {
    const input = passing();
    addFactory(
      input,
      "static/chunks/editor.js",
      [30],
      [src("both-BBBBBBBB.mjs")]
    );
    const result = consumerFindings(input);
    expect(result.problems).toEqual([]);
    expect(result.copied).toEqual([{ module: "both-BBBBBBBB.mjs", count: 2 }]);
  });

  it("reports a plugin page the first load does not register", () => {
    const input = passing();
    const shell = input.output.chunks.get("static/chunks/shell.js");
    shell.factories.splice(2, 1);
    shell.sources.delete(PLUGIN);
    expect(kinds(input)).toEqual(["plugin-page-not-registered"]);
  });

  it("reports the workspace's admin bundled in place of the packed one", () => {
    const input = passing();
    addFactory(
      input,
      "static/chunks/editor.js",
      [43],
      ["packages/admin/dist/index.mjs"]
    );
    expect(kinds(input)).toEqual(["not-the-packed-package"]);
  });

  it("reports Lexical's development build, and an output with no Lexical to judge", () => {
    const input = passing();
    input.output.chunks.get("static/chunks/editor.js").code =
      `throw Error("${LEXICAL_DEVELOPMENT_TEXTS[0]}")`;
    expect(kinds(input)).toEqual([
      "lexical-development-build",
      "lexical-unread",
    ]);
  });

  it("reports a module the packed package does not hold", () => {
    const input = passing();
    addFactory(
      input,
      "static/chunks/editor.js",
      [44],
      [src("stray-XXXXXXXX.mjs")]
    );
    expect(kinds(input)).toEqual(["unknown-module"]);
  });

  it("refuses an output it read nothing from", () => {
    const input = passing();
    input.pinned = [];
    input.output.firstLoads = new Map();
    for (const each of input.output.chunks.values()) {
      each.factories = [];
      each.sources = new Set();
    }
    const found = kinds(input);
    expect(found).toContain("nothing-read");
    expect(found).toContain("no-first-load");
  });
});
