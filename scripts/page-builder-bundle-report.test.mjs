/**
 * The page builder's budgets per admin screen (`page-builder-bundle-report.mjs`):
 * a screen that draws none of the builder's parts carries its registration
 * alone, within the budget and with no module of the editor or the CSS
 * parser; the builder holds its on-demand parts back until they open; the
 * editor stylesheet is not linked before any screen renders, and the builder
 * can fetch it; a known miss passes until it stops happening. And how much of
 * a chunk each source accounts for, read from its source map.
 */
import { describe, expect, it } from "vitest";

import {
  breaches,
  fetchableStylesheets,
  judge,
  narrowEngineSources,
  REGISTRATION_BUDGET_KB,
  SCREENS,
  sourceLengths,
} from "./page-builder-bundle-report.mjs";

const EDITOR_SHEET = {
  path: "static/chunks/b.css",
  sources: ["packages/plugin-page-builder/dist/styles/editor.css"],
};

/** A measured screen whose groups hold what `groups` says, empty otherwise. */
function screen(name, groups = {}, fetchable = [EDITOR_SHEET]) {
  const empty = { gzippedBytes: 0, sources: [] };
  return {
    name,
    chunks: [],
    gzippedBytes: 0,
    fetchableStylesheets: fetchable,
    groups: {
      "page builder": empty,
      "block engine": empty,
      "block engine beyond its narrow entries": empty,
      "builder editor": empty,
      "CSS parser": empty,
      "site-code section": empty,
      "icon set": empty,
      "font studio": empty,
      "builder fonts panel": empty,
      ...groups,
    },
  };
}

const ADMIN_SHEET = {
  path: "static/chunks/a.css",
  sources: ["packages/admin/src/styles/globals.css"],
};

describe("breaches", () => {
  it("passes screens within every budget", () => {
    expect(
      breaches(
        [
          screen("sign-in", {
            "page builder": { gzippedBytes: 12 * 1024, sources: ["x"] },
          }),
          screen("dashboard"),
          screen("builder", {
            "builder editor": {
              gzippedBytes: 1,
              sources: ["packages/builder/src/a.ts"],
            },
          }),
        ],
        [ADMIN_SHEET]
      )
    ).toEqual([]);
  });

  it("names a registration over its budget, with its size and the budget", () => {
    const over = (REGISTRATION_BUDGET_KB + 1) * 1024;
    expect(
      breaches(
        [
          screen("dashboard", {
            "page builder": { gzippedBytes: over, sources: [] },
          }),
        ],
        []
      )
    ).toEqual([
      `dashboard: the page builder's code is ${(REGISTRATION_BUDGET_KB + 1).toFixed(1)} KB gzipped, over its budget of ${REGISTRATION_BUDGET_KB} KB`,
    ]);
  });

  it("names the editor or the CSS parser on a screen that draws no part, by module", () => {
    expect(
      breaches(
        [
          screen("sign-in", {
            "builder editor": {
              gzippedBytes: 1,
              sources: ["packages/builder/src/canvas.tsx"],
            },
            "CSS parser": {
              gzippedBytes: 1,
              sources: ["node_modules/css-tree/lib/index.js"],
            },
          }),
        ],
        []
      )
    ).toEqual([
      "sign-in: holds the builder editor (1 modules, e.g. packages/builder/src/canvas.tsx)",
      "sign-in: holds the CSS parser (1 modules, e.g. node_modules/css-tree/lib/index.js)",
    ]);
  });

  it("names block engine code beyond its narrow entries on a screen that draws no part", () => {
    expect(
      breaches(
        [
          screen("dashboard", {
            "block engine beyond its narrow entries": {
              gzippedBytes: 1,
              sources: ["packages/blocks-engine/src/style/compile-page.ts"],
            },
          }),
        ],
        []
      )
    ).toEqual([
      "dashboard: holds the block engine beyond its narrow entries (1 modules, e.g. packages/blocks-engine/src/style/compile-page.ts)",
    ]);
  });

  it("fails the CSS parser on the sign-in page or the dashboard: no known miss excuses it", () => {
    const found = [
      "sign-in: holds the CSS parser (76 modules, e.g. node_modules/css-tree/lib/index.js)",
      "dashboard: holds the CSS parser (76 modules, e.g. node_modules/css-tree/lib/index.js)",
      "dashboard, parts drawn: holds the CSS parser (76 modules, e.g. node_modules/css-tree/lib/index.js)",
    ];
    expect(judge(found)).toEqual(found);
  });

  it("names a part the builder holds before it opens", () => {
    expect(
      breaches(
        [
          screen("builder", {
            "site-code section": {
              gzippedBytes: 1,
              sources: [
                "packages/plugin-page-builder/src/admin/editor/site-code-settings.tsx",
              ],
            },
          }),
        ],
        []
      )
    ).toEqual([
      "builder: holds the site-code section before it opens (packages/plugin-page-builder/src/admin/editor/site-code-settings.tsx)",
    ]);
  });

  it("names the editor stylesheet linked before any screen renders", () => {
    expect(breaches([], [ADMIN_SHEET, EDITOR_SHEET])).toEqual([
      "every admin screen links the editor stylesheet (static/chunks/b.css) before it renders",
    ]);
  });

  it("names a builder whose chunks cannot fetch the editor stylesheet", () => {
    expect(breaches([screen("builder", {}, [ADMIN_SHEET])], [])).toEqual([
      "builder: none of its chunks can fetch the editor stylesheet",
    ]);
  });

  it("judges the screens it measures", () => {
    expect(SCREENS.map(s => s.name)).toEqual([
      "sign-in",
      "dashboard",
      "dashboard, parts drawn",
      "builder",
    ]);
  });

  it("follows the dashboard to the plugin's parts it draws without a click", () => {
    // The Bindings to fix card, drawn when there are bindings to fix, and the
    // header's delete tools, drawn on every page for a host's component
    // store: each fetches its code as soon as the dashboard draws it.
    const opens = SCREENS.find(s => s.name === "dashboard, parts drawn").opens;
    const followed = [
      "packages/admin/src/pages/dashboard/index.tsx",
      "packages/plugin-page-builder/src/admin/bindings-report/BindingsToFixCard.tsx",
      "packages/plugin-page-builder/src/admin/DeleteComponentAction.tsx",
    ];

    expect(opens.map((opener, at) => opener.test(followed[at]))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("holds the dashboard with its parts drawn to the budgets of a screen with no editor", () => {
    const over = (REGISTRATION_BUDGET_KB + 1) * 1024;
    expect(
      breaches(
        [
          screen("dashboard, parts drawn", {
            "page builder": { gzippedBytes: over, sources: [] },
            "builder editor": {
              gzippedBytes: 1,
              sources: ["packages/builder/src/canvas.tsx"],
            },
          }),
        ],
        []
      )
    ).toEqual([
      `dashboard, parts drawn: the page builder's code is ${(REGISTRATION_BUDGET_KB + 1).toFixed(1)} KB gzipped, over its budget of ${REGISTRATION_BUDGET_KB} KB`,
      "dashboard, parts drawn: holds the builder editor (1 modules, e.g. packages/builder/src/canvas.tsx)",
    ]);
  });
});

describe("judge", () => {
  const known = [{ starts: "sign-in: holds the CSS parser", why: "core" }];

  it("passes a known miss and fails every other breach", () => {
    expect(
      judge(
        [
          "sign-in: holds the CSS parser (76 modules, e.g. css-tree)",
          "dashboard: holds the builder editor (1 modules, e.g. x)",
        ],
        known
      )
    ).toEqual(["dashboard: holds the builder editor (1 modules, e.g. x)"]);
  });

  it("fails a known miss that no longer happens, so its line is removed", () => {
    expect(judge([], known)).toEqual([
      '"sign-in: holds the CSS parser" no longer happens: remove it from KNOWN_MISSES',
    ]);
  });
});

describe("fetchableStylesheets", () => {
  it("finds a stylesheet a loader in the chunks names, and only that one", () => {
    const output = {
      chunks: new Map([
        [
          "a.js",
          { code: 'Promise.all(["static/chunks/b.css","static/chunks/c.js"])' },
        ],
      ]),
    };

    expect(
      fetchableStylesheets(output, ["a.js"], [ADMIN_SHEET, EDITOR_SHEET])
    ).toEqual([EDITOR_SHEET]);
  });
});

describe("sourceLengths", () => {
  it("gives each source the code from its segments to the next", () => {
    // Line 0: "AAAABBBB", a segment at column 0 for source 0 and one at
    // column 4 for source 1 (base64 VLQ: "AAAA" and "ICAA").
    const map = {
      sources: [
        "turbopack:///[project]/packages/a.ts",
        "turbopack:///[project]/packages/b.ts",
      ],
      mappings: "AAAA,ICAA",
    };

    expect(sourceLengths("AAAABBBB", map)).toEqual(
      new Map([
        ["packages/a.ts", 4],
        ["packages/b.ts", 4],
      ])
    );
  });
});

describe("the block engine's narrow entries", () => {
  const packageJson = {
    exports: {
      ".": { import: "./dist/index.mjs" },
      "./contrast": { import: "./dist/contrast.mjs" },
      "./named-query": { default: "./dist/named-query.mjs" },
    },
  };
  // The root, two narrow entries, the chunk one of them shares with the root,
  // and a chunk only the root reaches.
  const metafile = {
    outputs: {
      "dist/index.mjs": {
        imports: [
          { path: "dist/contrast-a1.mjs" },
          { path: "dist/compile-b2.mjs" },
          { path: "css-tree/parser", external: true },
        ],
        inputs: { "src/index.ts": {} },
      },
      "dist/contrast.mjs": {
        imports: [{ path: "dist/contrast-a1.mjs" }],
        inputs: { "src/contrast.ts": {} },
      },
      "dist/contrast-a1.mjs": {
        imports: [],
        inputs: {
          "src/style/contrast.ts": {},
          "src/style/css-identifier.ts": {},
        },
      },
      "dist/named-query.mjs": {
        imports: [],
        inputs: { "src/named-query.ts": {}, "src/plain-record.ts": {} },
      },
      "dist/compile-b2.mjs": {
        imports: [],
        inputs: { "src/style/compile-page.ts": {} },
      },
    },
  };
  const sources = narrowEngineSources(packageJson, metafile);

  it("holds what each subpath export other than the root reaches, as source and as built", () => {
    expect([...sources].sort()).toEqual(
      [
        "packages/blocks-engine/dist/contrast.mjs",
        "packages/blocks-engine/dist/contrast-a1.mjs",
        "packages/blocks-engine/dist/named-query.mjs",
        "packages/blocks-engine/src/contrast.ts",
        "packages/blocks-engine/src/style/contrast.ts",
        "packages/blocks-engine/src/style/css-identifier.ts",
        "packages/blocks-engine/src/named-query.ts",
        "packages/blocks-engine/src/plain-record.ts",
      ].sort()
    );
  });

  it("leaves out what only the root reaches", () => {
    expect(sources.has("packages/blocks-engine/src/index.ts")).toBe(false);
    expect(
      sources.has("packages/blocks-engine/src/style/compile-page.ts")
    ).toBe(false);
    expect(sources.has("packages/blocks-engine/dist/compile-b2.mjs")).toBe(
      false
    );
  });

  it("lets through only the named entries, not every subpath export", () => {
    const withAnother = {
      exports: {
        ...packageJson.exports,
        "./style": { import: "./dist/compile-b2.mjs" },
      },
    };
    expect(
      narrowEngineSources(withAnother, metafile).has(
        "packages/blocks-engine/src/style/compile-page.ts"
      )
    ).toBe(false);
  });

  it("is empty without a build graph, so every engine module counts against a screen", () => {
    expect(narrowEngineSources(packageJson, undefined).size).toBe(0);
    expect(narrowEngineSources(undefined, metafile).size).toBe(0);
  });
});
