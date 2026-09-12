import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  collectDocSamples,
  compareToBaseline,
  compile,
  contextOnlyWorthRecording,
  deprecatedPropertiesIn,
  declaredNamesIn,
  extensionFor,
  extractFrom,
  identityOf,
  isModule,
  pageOf,
  readerOwnedName,
  classifyDocDiagnostics,
  constructedInBlock,
  mentionIsReaderOwned,
  misspelledExport,
  nameIn,
  namesToRebuild,
  readerOwnedMention,
  usedOnlyAsValue,
  workspaceValueExports,
  parseSample,
  rebaseContextDiagnostics,
  unaccountedFor,
  unterminatedFences,
  withEarlierContext,
} from "./check-doc-samples.mjs";

/**
 * Each guard is asserted against a CONTROL that reproduces what the checker did
 * before it: the same input, scored the old way, passing. A ratchet whose
 * verdict does not move is indistinguishable from a corpus that did not move,
 * so "the count stayed the same" is not evidence that a fix works — showing the
 * old scoring accept what the new scoring rejects is.
 */

/** A compiler host serving one in-memory `/probe.d.ts`, for the control below. */
const declarationHost = text => {
  const host = ts.createCompilerHost({});
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, langVersion, ...rest) =>
    name === "/probe.d.ts"
      ? ts.createSourceFile(name, text, langVersion, true, ts.ScriptKind.TS)
      : original(name, langVersion, ...rest);
  host.fileExists = name => name === "/probe.d.ts" || ts.sys.fileExists(name);
  host.readFile = name =>
    name === "/probe.d.ts" ? text : ts.sys.readFile(name);
  return host;
};

/** What the baseline held before fences were part of an identity. */
const messageOnly = line => line.slice(line.indexOf("  ") + 2);

/** A fingerprint keyed the old way, for the control side of each comparison. */
const fingerprintBy = (key, byFile) =>
  Object.fromEntries(
    Object.entries(byFile).map(([file, lines]) => {
      const counts = {};
      for (const line of lines)
        counts[key(line)] = (counts[key(line)] ?? 0) + 1;
      return [file, counts];
    })
  );

const coverageOf = perPage => ({
  files: Object.keys(perPage),
  samples: Object.values(perPage).reduce((n, p) => n + p.samples, 0),
  compiled: Object.values(perPage).reduce((n, p) => n + p.compiled, 0),
  perPage,
});

describe("identityOf", () => {
  it("keeps the fence and drops the line, so an edit above a fence does not churn the baseline", () => {
    const before = identityOf(
      "docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'."
    );
    const after = identityOf(
      "docs/a.mdx#3:40  error TS2304: Cannot find name 'Post'."
    );

    expect(before).toBe(after);
    expect(before).toBe("#3 error TS2304: Cannot find name 'Post'.");
  });

  it("tells two fences on one page apart when they carry the same message", () => {
    const third = "docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.";
    const seventh = "docs/a.mdx#7:4  error TS2304: Cannot find name 'Post'.";

    expect(identityOf(third)).not.toBe(identityOf(seventh));
    // The control: scored on the message alone these are one identity, which is
    // what let a page trade a fixed fence for a newly broken one.
    expect(messageOnly(third)).toBe(messageOnly(seventh));
  });

  it("strips an absolute root so a laptop and CI agree", () => {
    const onALaptop = identityOf(
      "docs/a.mdx#1:2  error TS2307: Cannot find module '/Users/me/nextly/x'.",
      "/Users/me/nextly"
    );
    const inCi = identityOf(
      "docs/a.mdx#1:2  error TS2307: Cannot find module '/home/runner/work/nextly/x'.",
      "/home/runner/work/nextly"
    );

    expect(onALaptop).toBe(inCi);
    expect(onALaptop).not.toContain("/Users/me");
  });

  it("gives a diagnostic with no fence no prefix rather than an invented one", () => {
    expect(identityOf("?:0  error TS5055: Would overwrite input file.")).toBe(
      "error TS5055: Would overwrite input file."
    );
  });
});

describe("compareToBaseline", () => {
  const perPage = { "docs/a.mdx": { samples: 4, compiled: 3 } };

  it("catches one fence being fixed while another breaks the same way", () => {
    const held = ["docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'."];
    const now = ["docs/a.mdx#7:4  error TS2304: Cannot find name 'Post'."];
    const baseline = {
      coverage: { pages: 1, samples: 4, compiled: 3 },
      samplesPerPage: perPage,
      pages: { "docs/a.mdx": 1 },
      findings: fingerprintBy(identityOf, { "docs/a.mdx": held }),
    };

    const { appeared, gone, worse, better } = compareToBaseline({
      baseline,
      coverage: coverageOf(perPage),
      counted: { "docs/a.mdx": 1 },
      fingerprint: fingerprintBy(identityOf, { "docs/a.mdx": now }),
    });

    expect(appeared).toEqual([
      "docs/a.mdx: #7 error TS2304: Cannot find name 'Post'.",
    ]);
    expect(gone).toEqual([
      "docs/a.mdx: #3 error TS2304: Cannot find name 'Post'.",
    ]);
    // The control: the count is equal either way, so nothing but the identities
    // is left to notice. Scored on messages alone, this state was accepted.
    expect(worse).toEqual([]);
    expect(better).toEqual([]);
    const control = compareToBaseline({
      baseline: {
        ...baseline,
        findings: fingerprintBy(messageOnly, { "docs/a.mdx": held }),
      },
      coverage: coverageOf(perPage),
      counted: { "docs/a.mdx": 1 },
      fingerprint: fingerprintBy(messageOnly, { "docs/a.mdx": now }),
    });
    expect(control.appeared).toEqual([]);
    expect(control.gone).toEqual([]);
  });

  describe("--only", () => {
    const twoPages = {
      "docs/a.mdx": { samples: 4, compiled: 3 },
      "docs/b.mdx": { samples: 2, compiled: 2 },
    };
    const baseline = {
      coverage: { pages: 2, samples: 6, compiled: 5 },
      samplesPerPage: twoPages,
      pages: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
      findings: {
        "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 },
        "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 1 },
      },
    };

    it("charges the selected page for swapping one diagnostic for another", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
        fingerprint: {
          "docs/a.mdx": {
            "#3 error TS2551: Property 'sizes' does not exist.": 1,
          },
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 1 },
        },
        only: "docs/a.mdx",
      });

      expect(verdict.appeared).toEqual([
        "docs/a.mdx: #3 error TS2551: Property 'sizes' does not exist.",
      ]);
      // The control: the page's total is 1 before and after, which is the whole
      // of what --only used to compare, so it exited successfully.
      expect(verdict.worse).toEqual([]);
      expect(verdict.better).toEqual([]);
    });

    it("charges the selected page for losing a compiled fence", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf({
          "docs/a.mdx": { samples: 4, compiled: 2 },
          "docs/b.mdx": { samples: 2, compiled: 2 },
        }),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 1 },
        fingerprint: baseline.findings,
        only: "docs/a.mdx",
      });

      expect(verdict.lost).toEqual(["docs/a.mdx: compiled was 3, now 2"]);
      expect(verdict.worse).toEqual([]);
      expect(verdict.better).toEqual([]);
    });

    it("does not charge the selected page for another page's regression", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 9 },
        fingerprint: {
          ...baseline.findings,
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 9 },
        },
        only: "docs/a.mdx",
      });

      expect(verdict).toEqual({
        lost: [],
        gained: [],
        appeared: [],
        gone: [],
        worse: [],
        better: [],
      });
    });

    it("still reports that regression when no page is selected", () => {
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf(twoPages),
        counted: { "docs/a.mdx": 1, "docs/b.mdx": 9 },
        fingerprint: {
          ...baseline.findings,
          "docs/b.mdx": { "#0 error TS2339: Property 'x' does not exist.": 9 },
        },
      });

      expect(verdict.worse).toEqual(["docs/b.mdx: allowed 1, found 9"]);
    });

    it("does not charge the selected page for the repository's totals", () => {
      // Another page left the set entirely. That is a repository-wide loss and
      // the whole-repository run reports it; a person checking their own page
      // should not be handed somebody else's.
      const verdict = compareToBaseline({
        baseline,
        coverage: coverageOf({ "docs/a.mdx": { samples: 4, compiled: 3 } }),
        counted: { "docs/a.mdx": 1 },
        fingerprint: { "docs/a.mdx": baseline.findings["docs/a.mdx"] },
        only: "docs/a.mdx",
      });

      expect(verdict.lost).toEqual([]);
    });
  });

  describe("--write-baseline", () => {
    // The write path refuses on the SAME `appeared` list the comparison path
    // reports, so what one calls a regression the other cannot record silently.
    it("reports a diagnostic the held baseline does not carry", () => {
      const perPageHere = { "docs/a.mdx": { samples: 4, compiled: 3 } };
      const { appeared } = compareToBaseline({
        baseline: {
          coverage: { pages: 1, samples: 4, compiled: 3 },
          samplesPerPage: perPageHere,
          pages: { "docs/a.mdx": 1 },
          findings: {
            "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 },
          },
        },
        coverage: coverageOf(perPageHere),
        counted: { "docs/a.mdx": 2 },
        fingerprint: {
          "docs/a.mdx": {
            "#3 error TS2304: Cannot find name 'Post'.": 1,
            "#4 error TS2304: Cannot find name 'Page'.": 1,
          },
        },
      });

      expect(appeared).toEqual([
        "docs/a.mdx: #4 error TS2304: Cannot find name 'Page'.",
      ]);
    });

    it("reports nothing when the audit matches what the baseline holds", () => {
      const perPageHere = { "docs/a.mdx": { samples: 4, compiled: 3 } };
      const findings = {
        "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 },
      };

      const { appeared } = compareToBaseline({
        baseline: {
          coverage: { pages: 1, samples: 4, compiled: 3 },
          samplesPerPage: perPageHere,
          pages: { "docs/a.mdx": 1 },
          findings,
        },
        coverage: coverageOf(perPageHere),
        counted: { "docs/a.mdx": 1 },
        fingerprint: findings,
      });

      expect(appeared).toEqual([]);
    });
  });
});

describe("pageOf", () => {
  it("takes the page off an attributed diagnostic", () => {
    expect(
      pageOf("docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.")
    ).toBe("docs/a.mdx");
  });

  it("groups an unattributed diagnostic under `?` rather than under its own message", () => {
    // A diagnostic the compiler could not place carries `?:0` and no `#`, so
    // splitting the raw line on `#` returned the whole line. That made a page
    // key out of an error message, and the gate then reported that message as a
    // page over an allowance of zero.
    const line = "?:0  error TS5055: Would overwrite input file.";

    expect(pageOf(line)).toBe("?");
    // The control: the old grouping kept the entire diagnostic.
    expect(line.split("#")[0]).toBe(line);
  });
});

describe("declaredNamesIn scope tracking", () => {
  // What the character count did, reproduced exactly, as the control.
  const blankNestedByCounting = code => {
    let depth = 0;
    return code
      .split("\n")
      .map(line => {
        const here = depth;
        for (const ch of line) {
          if (ch === "{" || ch === "(" || ch === "[") depth += 1;
          else if (ch === "}" || ch === ")" || ch === "]")
            depth = Math.max(0, depth - 1);
        }
        return here === 0 ? line : "";
      })
      .join("\n");
  };

  it("does not promote a nested name when a string contains a closing brace", () => {
    const code = 'function setup() { const marker = "}"; const hidden = {}; }';

    expect(declaredNamesIn(code).includes("setup")).toBe(true);
    expect(declaredNamesIn(code).includes("hidden")).toBe(false);
    // The control: counting characters closes on the string, so the rest of
    // the line reads as top level and `hidden` looks page-scoped. A later
    // import-free fence using it is then excused as a continuation.
    expect(blankNestedByCounting(code)).toContain("hidden");
  });

  it("does not promote a nested name when a comment contains a closing brace", () => {
    const code = [
      "function setup() {",
      "  // closes here: }",
      "  const hidden = 1;",
      "}",
    ].join("\n");

    expect(declaredNamesIn(code).includes("hidden")).toBe(false);
    expect(blankNestedByCounting(code)).toContain("hidden");
  });

  it("still reads a genuinely top-level declaration", () => {
    const code = ['const marker = "}";', "const shown = 1;"].join("\n");

    expect(declaredNamesIn(code).includes("marker")).toBe(true);
    expect(declaredNamesIn(code).includes("shown")).toBe(true);
  });
});

describe("extractFrom fence delimiters", () => {
  const body =
    'import { defineConfig } from "nextly";\nexport default defineConfig({});';

  it("reads a tilde-fenced TypeScript block", () => {
    // CommonMark allows `~~~`. Recognising only backticks made such a block
    // invisible to extraction, so publishing one that does not compile lowered
    // no coverage number and passed.
    const samples = extractFrom(
      "markdown-dir",
      `~~~ts\n${body}\n~~~\n`,
      "docs/a.mdx"
    );

    expect(samples).toHaveLength(1);
    expect(samples[0].code).toContain("defineConfig");
  });

  it("still reads a backtick-fenced block", () => {
    const samples = extractFrom(
      "markdown-dir",
      ["```ts", body, "```", ""].join("\n"),
      "docs/a.mdx"
    );

    expect(samples).toHaveLength(1);
  });

  it("does not let one delimiter family close the other", () => {
    // The closing run is a backreference, so this is an unterminated fence and
    // matches nothing rather than swallowing the rest of the page.
    expect(
      extractFrom("markdown-dir", `~~~ts\n${body}\n\`\`\`\n`, "docs/a.mdx")
    ).toEqual([]);
  });
});

describe("declaredNamesIn and regex literals", () => {
  it("does not promote a nested name when a regex contains a closing brace", () => {
    const code = "function setup() { const re = /}/; const hidden = {}; }";

    expect(declaredNamesIn(code).includes("setup")).toBe(true);
    expect(declaredNamesIn(code).includes("hidden")).toBe(false);
    expect(declaredNamesIn(code).includes("re")).toBe(false);
  });

  it("still reads division as division", () => {
    // The rescan is conditional on what precedes the slash. Treating every
    // slash as a regex would swallow the rest of the line here, and `half`
    // would disappear along with it.
    const code = ["const total = 10;", "const half = total / 2;"].join("\n");

    expect(declaredNamesIn(code).includes("total")).toBe(true);
    expect(declaredNamesIn(code).includes("half")).toBe(true);
  });

  it("reads a top-level regex without losing what follows it", () => {
    const code = ["const re = /}/;", "const after = 1;"].join("\n");

    expect(declaredNamesIn(code).includes("re")).toBe(true);
    expect(declaredNamesIn(code).includes("after")).toBe(true);
  });
});

describe("isModule", () => {
  it("counts a dynamic import, which loads a package like the declaration does", () => {
    expect(isModule('const nx = await import("nextly");')).toBe(true);
    // The control: the rule this replaced saw only declarations, exports and
    // require, so such a fence was extracted and never compiled.
    const declarationsOnly = c =>
      /^\s*import\b/m.test(c) ||
      /^\s*export\b/m.test(c) ||
      /(?:^|[^.\w])require\s*\(/m.test(c);
    expect(declarationsOnly('const nx = await import("nextly");')).toBe(false);
  });

  it("does not count a property access that happens to be named import", () => {
    expect(isModule("registry.import(thing);")).toBe(false);
    expect(isModule("const a = 1;")).toBe(false);
  });
});

describe("unterminatedFences", () => {
  const body = 'import { defineConfig } from "nextly";';

  it("reports a TypeScript fence that never closes", () => {
    expect(
      unterminatedFences(
        ["```ts", body, "", "prose that never closes"].join("\n")
      )
    ).toEqual(["```ts"]);
  });

  it("reports nothing for a fence that does close", () => {
    expect(
      unterminatedFences(["```ts", body, "```", "", "prose"].join("\n"))
    ).toEqual([]);
  });

  it("ignores an unclosed fence that is not TypeScript", () => {
    // The gate compiles TypeScript. An unclosed shell block is a rendering
    // problem for somebody else to care about, and refusing on it would make
    // this check fail for reasons it cannot act on.
    expect(
      unterminatedFences(["```bash", "echo hi", "", "prose"].join("\n"))
    ).toEqual([]);
  });

  it("reports an unclosed tilde fence too", () => {
    expect(unterminatedFences(["~~~ts", body, "", "prose"].join("\n"))).toEqual(
      ["~~~ts"]
    );
  });
});

describe("extensionFor", () => {
  const jsx = "const a = <div />;";

  it("lets a stated .ts filename beat an inference from the body", () => {
    // A fence headed `ts title="nextly.config.ts"` names the file a reader
    // pastes into. Compiling it as tsx because it holds an angle bracket
    // checks it under rules that reader never gets.
    expect(
      extensionFor({ lang: "ts", meta: ' title="nextly.config.ts"', code: jsx })
    ).toBe("ts");
    expect(
      extensionFor({ lang: "ts", meta: ' title="app/page.tsx"', code: jsx })
    ).toBe("tsx");
  });

  it("infers from the body when no filename is stated", () => {
    expect(extensionFor({ lang: "ts", meta: "", code: jsx })).toBe("tsx");
    expect(extensionFor({ lang: "ts", meta: "", code: "const a = 1;" })).toBe(
      "ts"
    );
  });

  it("ignores a stated filename on a rebuilt sample", () => {
    // A rebuilt sample carries the original fence's metadata while being a
    // concatenation that title does not describe. Forcing `.ts` on one whose
    // pasted prefix holds JSX makes it fail to parse for a reason the page
    // does not have.
    expect(
      extensionFor({
        lang: "ts",
        meta: ' title="nextly.config.ts"',
        code: jsx,
        prependedLines: 4,
      })
    ).toBe("tsx");
  });
});

describe("declaredNamesIn and imports that are not declarations", () => {
  it("does not bind a name from an import inside a block comment", () => {
    const code = [
      "/*",
      'import { ghost } from "pkg";',
      "*/",
      "const real = 1;",
    ].join("\n");

    expect(declaredNamesIn(code)).toEqual(["real"]);
    // The control: the pattern this replaced read the raw text and could not
    // tell a comment from a statement, so a later fence using `ghost` was
    // excused as a continuation of a page that never bound it.
    const byPattern = [...code.matchAll(/^\s*import\s+([^;]*?)\s+from\s/gms)]
      .length;
    expect(byPattern).toBe(1);
  });

  it("still binds every form a real import declares", () => {
    // A parser swap can quietly lose a shape, so all four are asserted.
    const wrapped = [
      "import {",
      "  defineConfig,",
      "  type Foo,",
      '} from "nextly";',
    ].join("\n");
    expect(declaredNamesIn(wrapped).sort()).toEqual(["Foo", "defineConfig"]);
    expect(declaredNamesIn('import D, * as NS from "p";').sort()).toEqual([
      "D",
      "NS",
    ]);
    expect(declaredNamesIn('import { a as b } from "p";')).toEqual(["b"]);
  });
});

describe("compareToBaseline and coverage gains", () => {
  const perPage = { "docs/a.mdx": { samples: 4, compiled: 3 } };
  const baseline = {
    coverage: { pages: 1, samples: 4, compiled: 3 },
    samplesPerPage: perPage,
    pages: {},
    findings: {},
  };
  const coverageOf = p => ({
    files: Object.keys(p),
    samples: Object.values(p).reduce((n, x) => n + x.samples, 0),
    compiled: Object.values(p).reduce((n, x) => n + x.compiled, 0),
    perPage: p,
  });

  it("asks for a rewrite when a page gains a sample", () => {
    // A gain the baseline is never told about is not protected: the fence can
    // be deleted again tomorrow, every count returns to what is recorded, and
    // both changes pass.
    const grown = { "docs/a.mdx": { samples: 5, compiled: 4 } };
    const { gained, lost } = compareToBaseline({
      baseline,
      coverage: coverageOf(grown),
      counted: {},
      fingerprint: {},
    });

    expect(gained.length).toBeGreaterThan(0);
    expect(lost).toEqual([]);
  });

  it("asks for a rewrite when a page the baseline never saw appears", () => {
    const withNewPage = {
      "docs/a.mdx": { samples: 4, compiled: 3 },
      "docs/b.mdx": { samples: 2, compiled: 2 },
    };
    const { gained } = compareToBaseline({
      baseline,
      coverage: coverageOf(withNewPage),
      counted: {},
      fingerprint: {},
    });

    expect(gained.join("\n")).toContain("docs/b.mdx");
  });

  it("says nothing when coverage matches what is recorded", () => {
    const { gained, lost } = compareToBaseline({
      baseline,
      coverage: coverageOf(perPage),
      counted: {},
      fingerprint: {},
    });

    expect(gained).toEqual([]);
    expect(lost).toEqual([]);
  });
});

describe("isModule reads the tree, not the text", () => {
  const cases = [
    [
      '// dynamically import("nextly")\nconst a = { b: 1 };',
      false,
      "a mention in a comment",
    ],
    ['const s = "import(x)";', false, "a mention in a string"],
    ['const nx = await import("nextly");', true, "a real dynamic import"],
    ['const c = require("crypto");', true, "a require call"],
    ["registry.require(thing);", false, "a property access named require"],
    ['import x from "nextly";', true, "a declaration"],
    ["export const a = 1;", true, "an export modifier"],
    ["export default {};", true, "an export assignment"],
    ['export { a } from "m";', true, "a re-export"],
    ["const a = 1;", false, "a plain fragment"],
  ];

  for (const [code, want, what] of cases) {
    it(`answers ${String(want)} for ${what}`, () => {
      expect(isModule(code)).toBe(want);
    });
  }

  it("differs from the text pattern it replaced", () => {
    // The control. A pattern cannot tell a call from a mention, so a comment
    // made a fragment look like a module and the audit compiled a block it
    // deliberately excludes.
    const mention = '// dynamically import("nextly")\nconst a = { b: 1 };';
    expect(/(?:^|[^.\w])import\s*\(/m.test(mention)).toBe(true);
    expect(isModule(mention)).toBe(false);
  });
});

describe("declaredNamesIn under the right grammar", () => {
  const code = [
    "const id = <T>(x: T) => x;",
    'import { defineConfig } from "nextly";',
  ].join("\n");

  it("keeps the imports of a .ts sample that TSX would misparse", () => {
    // `<T>(x: T) => x` is a generic arrow in .ts and an unclosed element in
    // .tsx. Parsing a .ts sample as TSX yields a recovery tree that drops every
    // import after it, so the names went missing while the fence still
    // compiled, and a later fence using one was reported as undefined.
    expect(declaredNamesIn(code, "ts").sort()).toEqual(["defineConfig", "id"]);
    // The control: the grammar this used unconditionally loses the import.
    expect(declaredNamesIn(code, "tsx")).toEqual(["id"]);
  });
});

describe("unaccountedFor", () => {
  const complete = {
    total: 10,
    real: 4,
    continued: 2,
    readerFiles: 2,
    readerNames: 0,
    uninstalled: 1,
    implicitAny: 1,
  };

  it("is zero when every diagnostic went somewhere", () => {
    expect(unaccountedFor(complete)).toBe(0);
  });

  it("counts what a forgotten bucket would leave behind", () => {
    // The case this exists for: a future bucket reported to the console and
    // left out of both the findings and the set-aside list.
    expect(unaccountedFor({ ...complete, uninstalled: 0 })).toBe(1);
  });

  it("would not have noticed with a surplus term in the sum", () => {
    // Why the comparison is exact rather than "at least". Adding a term that
    // is not part of the partition, as counting the whole set-aside list did,
    // lets a missing bucket hide behind it.
    const withSurplus = {
      ...complete,
      uninstalled: 0,
      real: complete.real + 1,
    };
    expect(unaccountedFor(withSurplus)).toBe(0);
  });
});

describe("unterminatedFences and closing lines", () => {
  it("does not accept a delimiter carrying attributes as a closer", () => {
    // ```` ```{.foo} ```` has an empty language capture, so checking only that
    // capture treated it as a closer. `extractFrom` rejects the same line,
    // because a closing fence may hold only the delimiter and whitespace, so
    // the sample went neither extracted nor reported.
    const page = ["```ts", "const a = 1;", "```{.foo}", "", "prose"].join("\n");

    expect(unterminatedFences(page)).toEqual(["```ts"]);
    expect(extractFrom("markdown-dir", page, "d.mdx")).toEqual([]);
  });

  it("still accepts a plain closer, and one with trailing whitespace", () => {
    expect(
      unterminatedFences(["```ts", "const a = 1;", "```", ""].join("\n"))
    ).toEqual([]);
    expect(
      unterminatedFences(["```ts", "const a = 1;", "```   ", ""].join("\n"))
    ).toEqual([]);
  });
});

describe("isModule asks the compiler rather than listing node kinds", () => {
  /**
   * The kinds this used to enumerate, as the control.
   *
   * A list answers only for what somebody thought of, and this one was short in
   * both directions at once, which is the shape a list always fails in.
   */
  const byKindList = (code, extension = "ts") =>
    parseSample(code, extension).statements.some(
      statement =>
        ts.isImportDeclaration(statement) ||
        ts.isImportEqualsDeclaration(statement) ||
        ts.isExportDeclaration(statement) ||
        ts.isExportAssignment(statement) ||
        (ts.getModifiers?.(statement) ?? statement.modifiers ?? []).some(
          modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    );

  it("compiles a fence whose only module syntax is import.meta", () => {
    // TypeScript sets its module indicator for `import.meta`, so this fence is
    // a module to the compiler that would compile it while the list read it as
    // a fragment. Neither the reviewer nor the list found this one.
    const code = "const here = import.meta.url;\nconsole.log(here);\n";
    expect(isModule(code, "ts")).toBe(true);
    expect(byKindList(code)).toBe(false);
  });

  it("leaves a namespace alias alone", () => {
    // `import A = N.M` names an existing namespace rather than loading a
    // module, and TypeScript does not call the file a module for it. The list
    // matched every ImportEqualsDeclaration, so it read this as a program.
    const code = "import A = N.M;\n";
    expect(isModule(code, "ts")).toBe(false);
    expect(byKindList(code)).toBe(true);
  });

  it("still answers for the cases the list got right", () => {
    // The control on the control: a predicate that answered false to
    // everything would satisfy two of the three assertions above.
    expect(isModule('import x from "nextly";', "ts")).toBe(true);
    expect(isModule("export const a = 1;", "ts")).toBe(true);
    expect(isModule("const a = 1;", "ts")).toBe(false);
  });
});

describe("rebaseContextDiagnostics accounts for every line", () => {
  const prependedByOrigin = new Map([["docs/p.mdx#3", 4]]);
  const at = (lineNo, message) => `docs/p.mdx#3:${String(lineNo)}  ${message}`;

  it("returns a diagnostic about a pasted declaration instead of dropping it", () => {
    // Line 2 is inside the four prepended lines, and the message is neither an
    // artefact of pasting nor an implicit any. Only the origin used to come
    // back: the report named the sample unchecked and the line itself reached
    // nothing the gate compares, so a fence could stop being checked while
    // every number stood still.
    const line = at(2, "error TS2304: Cannot find name 'PluginDefinition'.");
    const result = rebaseContextDiagnostics({
      lines: [line],
      prependedByOrigin,
    });
    expect(result.contextOnly).toEqual([line]);
    expect([...result.unresolvedInContext]).toEqual(["docs/p.mdx#3"]);
    // The control: it is still not rebased onto the reader's page, because it
    // belongs to a block that is not the one being reported.
    expect(result.lines).toEqual([]);
  });

  it("puts every line in exactly one bucket", () => {
    const lines = [
      at(1, "error TS2300: Duplicate identifier 'adapter'."),
      at(2, "error TS7006: Parameter 'doc' implicitly has an 'any' type."),
      at(3, "error TS2304: Cannot find name 'PluginDefinition'."),
      at(9, "error TS2551: Property 'connectTypo' does not exist."),
    ];
    const result = rebaseContextDiagnostics({ lines, prependedByOrigin });
    const partitioned =
      result.lines.length +
      result.artefacts.length +
      result.implicitAnyInContext.length +
      result.contextOnly.length;
    expect(partitioned).toBe(lines.length);
    // Named, not just counted: four equal totals can be reached by putting two
    // lines in one bucket and none in another.
    expect(result.artefacts).toHaveLength(1);
    expect(result.implicitAnyInContext).toHaveLength(1);
    expect(result.contextOnly).toHaveLength(1);
    expect(result.lines).toHaveLength(1);
    // The one past the prepended region is the reader's, rebased onto their
    // own line numbering.
    expect(result.lines[0]).toContain("docs/p.mdx#3:5");
  });
});

describe("a fence whose only module syntax is a namespace export", () => {
  const namespaceOnly =
    "export as namespace Nextly;\ndeclare const a: number;\n";

  it("stays a fragment", () => {
    expect(isModule(namespaceOnly, "ts")).toBe(false);
  });

  it("is not invisible, because an uncompiled fence still counts as a sample", () => {
    // The reason the line above is deliberate rather than a hole. Coverage is
    // ratcheted per page in both directions, so a page that gains a fence the
    // gate cannot compile fails on its sample count until somebody rewrites the
    // baseline. Asserted through the comparison the gate actually runs.
    const coverage = {
      files: ["docs/a.mdx"],
      samples: 2,
      compiled: 1,
      perPage: { "docs/a.mdx": { samples: 2, compiled: 1 } },
    };
    const baseline = {
      coverage: { pages: 1, samples: 1, compiled: 1 },
      samplesPerPage: { "docs/a.mdx": { samples: 1, compiled: 1 } },
      counted: {},
      findings: {},
    };
    const { gained } = compareToBaseline({
      baseline,
      coverage,
      counted: {},
      fingerprint: {},
    });
    expect(gained.join("\n")).toContain("samples was 1, now 2");
  });

  it("would be counted as compiled while checking nothing, if it were compiled", () => {
    // The other half of the reason. `compileOnce` runs with `skipLibCheck`,
    // under which a declaration file's body reports nothing at all, and it
    // appends `export {}` to every sample, which makes a namespace-only
    // declaration file valid and erases the one error a reader would meet.
    const broken = "export interface Thing { a: NoSuchTypeAnywhere }\n";
    const asScript = compile(
      [{ file: "docs/a.mdx", index: 0, lang: "ts", meta: "", code: broken }],
      "test-script-checks"
    );
    expect(asScript.join("\n")).toContain("TS2304");
    // The control: the same body under the options a declaration file would get
    // is silent, so "compiled" would not mean "checked".
    const program = ts.createProgram(
      ["/probe.d.ts"],
      {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        lib: ["lib.es2022.d.ts"],
      },
      declarationHost(`${broken}\nexport {};\n`)
    );
    expect(
      program.getSemanticDiagnostics(program.getSourceFile("/probe.d.ts"))
    ).toEqual([]);
  });
});

describe("withEarlierContext says which fence each pasted line came from", () => {
  const page = [
    {
      file: "docs/p.mdx",
      index: 0,
      lang: "ts",
      code: "const first = 1;\nconst unused = 2;",
    },
    { file: "docs/p.mdx", index: 1, lang: "ts", code: "const second = first;" },
    { file: "docs/p.mdx", index: 2, lang: "ts", code: "console.log(second);" },
  ];

  it("maps a prepended line back to its block and that block's own numbering", () => {
    const rebuilt = withEarlierContext(page[2], ["second"], page);
    // Both earlier blocks are pulled in: the nearest one declares `second`, and
    // it needs `first` from the one before it.
    expect(rebuilt.pastedFrom.map(r => r.origin)).toEqual([
      "docs/p.mdx#0",
      "docs/p.mdx#1",
    ]);
    // Block 0 has two lines, then the join's blank line, so block 1 starts on
    // line 4 of the prefix.
    expect(rebuilt.pastedFrom[0]).toMatchObject({ from: 1, to: 2 });
    expect(rebuilt.pastedFrom[1]).toMatchObject({ from: 4, to: 4 });
    // The control: the ranges have to describe the prefix that was actually
    // built, not an assumed one.
    expect(rebuilt.code.split("\n").slice(0, 4)).toEqual([
      "const first = 1;",
      "const unused = 2;",
      "",
      "const second = first;",
    ]);
  });

  it("reports a diagnostic in the pasted region against the block that made it", () => {
    const rebuilt = withEarlierContext(page[2], ["second"], page);
    const result = rebaseContextDiagnostics({
      lines: ["docs/p.mdx#2:4  error TS2304: Cannot find name 'first'."],
      prependedByOrigin: new Map([["docs/p.mdx#2", rebuilt.prependedLines]]),
      pastedFromByOrigin: new Map([["docs/p.mdx#2", rebuilt.pastedFrom]]),
    });
    // Line 4 of the rebuilt file is line 1 of block 1.
    expect(result.contextOnly).toEqual([
      "docs/p.mdx#1:1  error TS2304: Cannot find name 'first'.",
    ]);
    // The control: without the ranges it can only report the fence that
    // inherited the declaration, which is not the one with the problem.
    const unattributed = rebaseContextDiagnostics({
      lines: ["docs/p.mdx#2:4  error TS2304: Cannot find name 'first'."],
      prependedByOrigin: new Map([["docs/p.mdx#2", rebuilt.prependedLines]]),
    });
    expect(unattributed.contextOnly).toEqual([
      "docs/p.mdx#2:4  error TS2304: Cannot find name 'first'.",
    ]);
  });
});

describe("contextOnlyWorthRecording deduplicates on identity", () => {
  const missingFoo = (origin, line) =>
    `${origin}:${String(line)}  error TS2304: Cannot find name 'Foo'.`;

  it("keeps a diagnostic another page happens to share a message with", () => {
    // The defect this replaced: the first pass was searched by message text
    // alone, across the whole corpus, so an unrelated page saying the same
    // thing silently swallowed a real context diagnostic. `Cannot find name`
    // is the commonest message in this corpus, so the collision is the rule
    // rather than the exception.
    const contextOnly = [missingFoo("docs/a.mdx#1", 3)];
    const firstPass = [missingFoo("docs/elsewhere.mdx#7", 12)];

    expect(contextOnlyWorthRecording({ contextOnly, firstPass })).toEqual(
      contextOnly
    );
    // The control: matched the old way, this one disappears.
    const messageOf = line => line.split("  ").slice(1).join("  ");
    expect(
      new Set(firstPass.map(messageOf)).has(messageOf(contextOnly[0]))
    ).toBe(true);
  });

  it("drops one the same fence already reported", () => {
    // A pasted block that was itself a module was compiled and judged on its
    // own, so the recompile saying it again adds nothing.
    const contextOnly = [missingFoo("docs/a.mdx#1", 3)];
    const firstPass = [missingFoo("docs/a.mdx#1", 3)];
    expect(contextOnlyWorthRecording({ contextOnly, firstPass })).toEqual([]);
  });

  it("does not confuse the same fence number on two pages", () => {
    // `identityOf` returns `#1 <message>`, which the baseline scopes by storing
    // it under a page. Used on its own as a key it makes fence 1 of every page
    // one diagnostic, so an unrelated page reporting the same thing at the same
    // ordinal would swallow this one.
    const contextOnly = [missingFoo("docs/a.mdx#1", 3)];
    const firstPass = [missingFoo("docs/elsewhere.mdx#1", 9)];
    expect(contextOnlyWorthRecording({ contextOnly, firstPass })).toEqual(
      contextOnly
    );
    // The control: the two really do share an identity, so only the page
    // separates them.
    expect(identityOf(contextOnly[0])).toBe(identityOf(firstPass[0]));
  });

  it("keeps two occurrences in one fence as two", () => {
    // `identityOf` drops the line number on purpose, so a finding that moves
    // down a fence stays the same finding. As a dedup key that is wrong: one
    // fence saying `Cannot find name 'Foo'` on two lines is two occurrences,
    // and the fingerprint downstream counts occurrences, so collapsing them
    // meant a second identical error moved nothing the gate compares.
    const contextOnly = [
      missingFoo("docs/a.mdx#1", 3),
      missingFoo("docs/a.mdx#1", 7),
    ];
    expect(contextOnlyWorthRecording({ contextOnly, firstPass: [] })).toEqual(
      contextOnly
    );
    // The control: the two really do share a baseline identity, so only the
    // location separates them.
    expect(identityOf(contextOnly[0])).toBe(identityOf(contextOnly[1]));
  });

  it("records a block pasted into several continuations once", () => {
    const contextOnly = [
      missingFoo("docs/a.mdx#1", 3),
      missingFoo("docs/a.mdx#1", 3),
    ];
    expect(
      contextOnlyWorthRecording({ contextOnly, firstPass: [] })
    ).toHaveLength(1);
  });
});

describe("a sample that writes a property the API has deprecated", () => {
  /** A two-file program: one declaring the API, one writing against it. */
  const program = source => {
    const dir = mkdtempSync(join(tmpdir(), "deprecated-"));
    writeFileSync(
      join(dir, "api.ts"),
      [
        "export interface Plugin {",
        "  /** @deprecated Prefer contributes.collections */",
        "  collections?: string[];",
        "  contributes?: { collections?: string[] };",
        "  admin?: { order?: number };",
        "}",
        "export interface Legacy {",
        '  kind: "legacy";',
        "  /** @deprecated Prefer nu */",
        "  old?: string;",
        "}",
        "export interface Current {",
        '  kind: "current";',
        "  nu?: string;",
        "}",
        "export interface StillOffered {",
        '  kind: "kept";',
        "  old?: string;",
        "}",
        "export interface Current2 {",
        '  kind: "current";',
        "  old?: string;",
        "}",
        "",
      ].join("\n")
    );
    writeFileSync(join(dir, "use.ts"), source);
    const files = [join(dir, "api.ts"), join(dir, "use.ts")];
    const built = ts.createProgram(files, {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      skipLibCheck: true,
    });
    return {
      dir,
      sourceFile: built.getSourceFile(join(dir, "use.ts")),
      checker: built.getTypeChecker(),
      program: built,
      files,
    };
  };

  const namesFlaggedIn = source => {
    const { sourceFile, checker, dir } = program(source);
    try {
      return deprecatedPropertiesIn(sourceFile, checker).map(d => d.name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("names the deprecated property and leaves its siblings alone", () => {
    expect(
      namesFlaggedIn(
        'import type { Plugin } from "./api";\n' +
          'export const p: Plugin = { collections: ["a"], admin: { order: 1 } };\n'
      )
    ).toEqual(["collections"]);
  });

  it("judges a nested literal against its own property's type", () => {
    // `contributes.collections` is a different property from the one beside
    // it, and only one of the two is deprecated. A check that matched on the
    // name would fail this.
    expect(
      namesFlaggedIn(
        'import type { Plugin } from "./api";\n' +
          'export const p: Plugin = { contributes: { collections: ["a"] } };\n'
      )
    ).toEqual([]);
  });

  it("skips a literal with no declared shape to be judged against", () => {
    // Nothing contextual, so nothing can be deprecated against it. This is
    // what keeps the check narrow rather than matching every property named
    // `collections` in the corpus.
    expect(
      namesFlaggedIn('export const p = { collections: ["a"] };\n')
    ).toEqual([]);
  });

  it("carries the deprecation's own note, which is where the fix is written", () => {
    const { sourceFile, checker, dir } = program(
      'import type { Plugin } from "./api";\n' +
        'export const p: Plugin = { collections: ["a"] };\n'
    );
    try {
      expect(deprecatedPropertiesIn(sourceFile, checker)[0].note).toBe(
        "Prefer contributes.collections"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a quoted key, which names the same member", () => {
    // `{ "collections": [] }` and `{ collections: [] }` are the same property.
    // Reading only identifiers let the quoted spelling walk past.
    expect(
      namesFlaggedIn(
        'import type { Plugin } from "./api";\n' +
          'export const p: Plugin = { "collections": ["a"] };\n'
      )
    ).toEqual(["collections"]);
  });

  it("looks inside a union rather than at the union", () => {
    // `getProperty` on a union answers for the union: a property present on one
    // constituent comes back undefined, so a deprecated option in a
    // union-shaped API passed unread.
    expect(
      namesFlaggedIn(
        'import type { Legacy, Current } from "./api";\n' +
          'export const u: Legacy | Current = { kind: "legacy", old: "x" };\n'
      )
    ).toEqual(["old"]);
  });

  it("answers from the arm the literal says it is", () => {
    // `{ kind: "legacy", old: "x" }` is not ambiguous: the discriminant names
    // the arm. Asking every arm and requiring agreement gave that up, so a key
    // deprecated on the arm actually being written passed whenever another arm
    // still offered it.
    expect(
      namesFlaggedIn(
        'import type { Legacy, Current2 } from "./api";\n' +
          'export const u: Legacy | Current2 = { kind: "legacy", old: "x" };\n'
      )
    ).toEqual(["old"]);
    // The other arm of the same union, which does not deprecate it.
    expect(
      namesFlaggedIn(
        'import type { Legacy, Current2 } from "./api";\n' +
          'export const u: Legacy | Current2 = { kind: "current", old: "x" };\n'
      )
    ).toEqual([]);
  });

  it("reads a computed key whose expression is a literal", () => {
    // `{ ["collections"]: [] }` names the same member and TypeScript resolves
    // it the same way. Only an expression that has to be evaluated is skipped.
    expect(
      namesFlaggedIn(
        'import type { Plugin } from "./api";\n' +
          'export const p: Plugin = { ["collections"]: ["a"] };\n'
      )
    ).toEqual(["collections"]);
  });

  it("stays quiet when one arm of a union still offers the name", () => {
    // Which arm this literal is depends on a discriminant, and nothing here
    // reads discriminants. Charging the page would be claiming the writer meant
    // the obsolete arm.
    expect(
      namesFlaggedIn(
        'import type { Legacy, StillOffered } from "./api";\n' +
          'export const u: Legacy | StillOffered = { kind: "kept", old: "x" };\n'
      )
    ).toEqual([]);
  });

  it("says nothing about a computed key it cannot resolve", () => {
    expect(
      namesFlaggedIn(
        'import type { Plugin } from "./api";\n' +
          'const k = "collections" as const;\n' +
          "export const p: Plugin = { [k]: ['a'] };\n"
      )
    ).toEqual([]);
  });

  it("is not something TypeScript already reports", () => {
    // The control, and the whole reason this function exists. Adding
    // suggestion diagnostics was the obvious answer and does not work: a
    // deprecated FUNCTION is reported, a deprecated property written in an
    // object literal is not, and the corpus's suggestions are otherwise
    // "declared but never read" on samples that show a shape rather than run.
    const {
      files,
      program: built,
      dir,
    } = program(
      'import type { Plugin } from "./api";\n' +
        'export const p: Plugin = { collections: ["a"] };\n'
    );
    try {
      const service = ts.createLanguageService({
        getScriptFileNames: () => files,
        getScriptVersion: () => "1",
        getScriptSnapshot: f =>
          ts.ScriptSnapshot.fromString(readFileSync(f, "utf-8")),
        getCurrentDirectory: () => dir,
        getCompilationSettings: () => built.getCompilerOptions(),
        getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
      });
      const reported = files.flatMap(f =>
        service.getSuggestionDiagnostics(f).filter(d => d.reportsDeprecated)
      );
      expect(reported).toEqual([]);
      // And the control on the control: the same service DOES report a
      // deprecated call, so the empty result above is a limit of what
      // TypeScript reports rather than a service that answers nothing.
      const fnDir = mkdtempSync(join(tmpdir(), "deprecated-fn-"));
      const fnFile = join(fnDir, "fn.ts");
      writeFileSync(
        fnFile,
        "/** @deprecated */\nfunction old(): void {}\nold();\nexport {};\n"
      );
      const fnProgram = ts.createProgram([fnFile], { noEmit: true });
      const fnService = ts.createLanguageService({
        getScriptFileNames: () => [fnFile],
        getScriptVersion: () => "1",
        getScriptSnapshot: f =>
          ts.ScriptSnapshot.fromString(readFileSync(f, "utf-8")),
        getCurrentDirectory: () => fnDir,
        getCompilationSettings: () => fnProgram.getCompilerOptions(),
        getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
      });
      expect(
        fnService
          .getSuggestionDiagnostics(fnFile)
          .filter(d => d.reportsDeprecated).length
      ).toBeGreaterThan(0);
      rmSync(fnDir, { recursive: true, force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a missing name the reader owns", () => {
  // An explicit set, so these state the RULE rather than the workspace. Reading
  // the workspace here made them depend on whether a build had run: CI runs the
  // script suite before the build step, the set came back empty, and every name
  // read as the reader's.
  const exported = new Set(["Media", "Skeleton", "Nextly", "NextlyError"]);
  const owned = name => readerOwnedName(name, exported);

  it("sets aside a type the reader's own project declares", () => {
    // `nextly generate:types` writes these into a reader's project, and a
    // component is theirs to write. Nothing in this workspace can define one,
    // so a page mentioning it is not broken.
    for (const name of ["Posts", "Users", "Page", "MyCollection", "Chart"]) {
      expect(owned(name)).toBe(true);
    }
  });

  it("keeps a name this workspace actually exports", () => {
    // The case that decides the rule. `Media` and `Skeleton` look exactly like
    // the names above and are the opposite: both ARE exported, from `nextly`
    // and `@nextlyhq/ui`, so a sample using one without importing it is a
    // defect a reader meets. A rule keyed on the shape alone would have
    // silenced five findings in the current corpus.
    for (const name of ["Media", "Skeleton", "Nextly", "NextlyError"]) {
      expect(owned(name)).toBe(false);
    }
  });

  it("leaves a value alone, whatever it is called", () => {
    // The shape narrows the question to names a reader DECLARES. An undefined
    // `orderData` or a bare `a` is an example that was left unfinished, which
    // is a finding.
    for (const name of ["orderData", "where", "a", "getPostBySlug"]) {
      expect(owned(name)).toBe(false);
    }
  });

  it("differs from the shape rule it replaces", () => {
    // The control. Both halves are load-bearing and this shows which half each
    // name needs: the shape rule alone accepts `Media`, and the export rule
    // alone accepts `orderData`.
    const looksOwned = name => /^[A-Z][A-Za-z0-9]*$/.test(name);
    expect(looksOwned("Media")).toBe(true);
    expect(owned("Media")).toBe(false);
    expect(looksOwned("orderData")).toBe(false);
    expect(owned("orderData")).toBe(false);
  });
});

describe("the workspace's own exported names", () => {
  // The rule above is stated against a fixture, so this is what ties it to
  // reality. Read from `src`, which is present whether or not a build has run,
  // so it answers the same on a clean checkout as on a laptop.
  //
  // The timeout is explicit because this is the one test that builds the real
  // program over every published entry. It took 13.7 seconds on an inspected
  // clean checkout, and vitest's 5-second default made that a red run on a
  // slower machine rather than a slow one.
  const BUILDS_THE_PROGRAM = 120_000;

  it(
    "knows what this workspace publishes and what it does not",
    () => {
      expect(readerOwnedName("Media")).toBe(false);
      expect(readerOwnedName("Skeleton")).toBe(false);
      // Published from a subpath and deliberately kept out of the root barrel.
      expect(readerOwnedName("BuilderShell")).toBe(false);
      // Entries whose output name does not mirror their source, which is what
      // made this answer depend on a build. `nextly/document-lock` is built
      // from `src/domains/document-lock/contract.ts`, and `@nextlyhq/ui`
      // declares its subpath sources in a module beside its build config, so
      // neither is reachable by turning `dist/X.d.ts` into `src/X.ts`. Each of
      // these read as the reader's on a clean checkout and as ours after a
      // build, which is the case that silences a real finding.
      expect(readerOwnedName("DocumentLockHolder")).toBe(false);
      expect(readerOwnedName("FieldTypeCatalogEntry")).toBe(false);
      expect(readerOwnedName("Hsv")).toBe(false);
      expect(readerOwnedName("FIELD_TYPE_CATALOG")).toBe(false);
      expect(readerOwnedName("WidgetResult")).toBe(false);
      // The reader's, and the control: a set that answered "exported" to
      // everything would satisfy every assertion above. `Users` is the one that
      // catches the opposite error: a scan of all source rather than of the
      // published entries picks up an icon barrel's `Users` and charges four
      // diagnostics for a name every reader generates.
      expect(readerOwnedName("Posts")).toBe(true);
      expect(readerOwnedName("MyCollection")).toBe(true);
      expect(readerOwnedName("Users")).toBe(true);
    },
    BUILDS_THE_PROGRAM
  );

  it(
    "separates the names that can supply a value",
    () => {
      // `Media` is exported as a type by `nextly` and as an interface by
      // `@nextlyhq/admin`, and by nothing as a value.
      expect(workspaceValueExports().has("Media")).toBe(false);
      // Declared type-only over a target that IS a value.
      // `export type { QueryClient } from "./types/query"` points at TanStack's
      // runtime class, so resolving the alias and stopping there called it a
      // value that `@nextlyhq/admin` cannot actually supply.
      expect(workspaceValueExports().has("QueryClient")).toBe(false);
      // The control: the same set answers yes for a real component and for a
      // value published from a subpath, so the two checks above are a namespace
      // distinction rather than an empty set.
      expect(workspaceValueExports().has("Skeleton")).toBe(true);
      expect(workspaceValueExports().has("BuilderShell")).toBe(true);
    },
    BUILDS_THE_PROGRAM
  );

  it(
    "keeps a broken sample rather than calling its name the reader's",
    () => {
      // Three shapes that are not reader-owned however they look: a class the
      // sample forgot to import, one of ours with a letter missing, and a
      // component of ours misspelled.
      expect(
        readerOwnedMention("S3Client", "const s = new S3Client({});", "ts")
      ).toBe(false);
      expect(
        readerOwnedMention("NextlyEror", "const e: NextlyEror = x;", "ts")
      ).toBe(false);
      expect(
        readerOwnedMention("Skelton", "const s = <Skelton />;", "tsx")
      ).toBe(false);
      // Construction settles it even for a name the workspace does export,
      // because a type-only export cannot supply the class either.
      expect(
        readerOwnedMention("QueryClient", "const q = new QueryClient();", "ts")
      ).toBe(false);
      // The control, and the reason the rule exists: the reader's own names
      // are still set aside, including the two that sit one character from a
      // model this workspace exports.
      for (const name of ["Posts", "Users", "Page", "Chart", "MyCollection"]) {
        expect(
          readerOwnedMention(
            name,
            `const c = { collections: [${name}] };`,
            "ts"
          )
        ).toBe(true);
      }
    },
    BUILDS_THE_PROGRAM
  );

  it(
    "reads a type-only name by how the block used it",
    () => {
      // `collections: [Posts, Users, Media]` needs a value, and no import here
      // can supply one, so that `Media` is the reader's own collection exactly
      // as `Posts` is.
      expect(
        readerOwnedMention(
          "Media",
          "const config = { collections: [Posts, Users, Media] };",
          "ts"
        )
      ).toBe(true);
      // The opposite, and the control: as a type it IS importable, so a sample
      // using it without the import is a defect a reader meets.
      expect(readerOwnedMention("Media", "declare const m: Media;", "ts")).toBe(
        false
      );
      // And `typeof Media` needs the value, which nothing here exports, so it
      // is the reader's the way `collections: [Media]` is.
      expect(readerOwnedMention("Media", "type X = typeof Media;", "ts")).toBe(
        true
      );
      // A name exported as a value stays a finding however it is used.
      expect(
        readerOwnedMention("Skeleton", "const el = <Skeleton />;", "tsx")
      ).toBe(false);
    },
    BUILDS_THE_PROGRAM
  );
});

describe("a name this workspace does not export", () => {
  // Not exporting a name is not the same as the reader owning it, and treating
  // the two as one made the gate accept samples that are simply broken.

  it("reads a qualified constructor by the name it needs in scope", () => {
    // `new AWS.S3Client()` needs `AWS`, not `S3Client`: the constructor is
    // reached through a namespace, and the namespace is the import the sample
    // forgot. Reading only a bare identifier missed every one of these.
    expect(
      constructedInBlock("const s = new AWS.S3Client();", "AWS", "ts")
    ).toBe(true);
    expect(
      constructedInBlock("const s = new AWS.deep.S3();", "AWS", "ts")
    ).toBe(true);
    // Wrappers that change nothing about which binding has to be in scope.
    expect(
      constructedInBlock(
        "const s = new (AWS.S3Client as new () => object)();",
        "AWS",
        "ts"
      )
    ).toBe(true);
    expect(
      constructedInBlock("const s = new AWS!.S3Client();", "AWS", "ts")
    ).toBe(true);
    // The control: the qualifier is what has to be in scope, not the property.
    expect(
      constructedInBlock("const s = new AWS.S3Client();", "S3Client", "ts")
    ).toBe(false);
    expect(
      readerOwnedMention("AWS", "const s = new AWS.S3Client();", "ts")
    ).toBe(false);
  });

  it("reads a constructed name as a class the sample forgot to import", () => {
    // `nextly generate:types` writes types, and a reader authors components.
    // Neither is a thing you call `new` on, so a constructed name is a runtime
    // class the sample did not import.
    expect(
      constructedInBlock("const s = new S3Client({});", "S3Client", "ts")
    ).toBe(true);
    // The controls: the same name used as a value is not construction, and a
    // name the block never mentions cannot be constructed by it.
    expect(constructedInBlock("const s = [S3Client];", "S3Client", "ts")).toBe(
      false
    );
    expect(constructedInBlock("const s = new Date();", "S3Client", "ts")).toBe(
      false
    );
  });

  it("reads one of our own names with a letter wrong as a misspelling", () => {
    const exported = new Set([
      "NextlyError",
      "Skeleton",
      "User",
      "Post",
      "users",
    ]);
    expect(misspelledExport("NextlyEror", exported)).toBe(true);
    expect(misspelledExport("Skelton", exported)).toBe(true);
  });

  it("does not read a short name that merely collides as a misspelling", () => {
    // One edit is a wide net over short names, and it was catching the reader.
    // Each of these is a name someone would plausibly give a component, and
    // each sits one substitution from something this workspace exports.
    const exported = new Set(["POST", "Cast", "Card", "Form", "List", "Post"]);
    for (const name of ["Host", "Cost", "Past", "Cart", "Fork", "Last"]) {
      expect(misspelledExport(name, exported)).toBe(false);
    }
  });

  it("still reads a long enough name as a misspelling", () => {
    // The control for the test above: the rule has to stay able to say yes.
    const exported = new Set(["POST", "NextlyError", "Skeleton"]);
    expect(misspelledExport("NextlyEror", exported)).toBe(true);
    expect(misspelledExport("Skelton", exported)).toBe(true);
  });

  it("catches a typo made in the first characters", () => {
    // Length is the discriminator rather than a shared opening, which this
    // first tried. A shared opening also discards a mistake made at the start
    // of the word, so `NNextlyError` read as a name the reader had declared.
    const exported = new Set(["NextlyError"]);
    expect(misspelledExport("NNextlyError", exported)).toBe(true);
    expect(
      readerOwnedMention("NNextlyError", "const e: NNextlyError = x;", "ts")
    ).toBe(false);
  });

  it("does not read a plural or a capital as a misspelling", () => {
    // The two that decide the rule. A generated collection type is the plural
    // of a model this workspace exports, so `Users` sits one character from
    // `User` and `Posts` one from `Post`; and `Users` sits one capital from an
    // internal `users`. Those are the names the exemption exists for.
    const exported = new Set([
      "NextlyError",
      "Skeleton",
      "User",
      "Post",
      "users",
    ]);
    expect(misspelledExport("Users", exported)).toBe(false);
    expect(misspelledExport("Posts", exported)).toBe(false);
    expect(misspelledExport("Page", exported)).toBe(false);
  });

  it("asks the set it was given", () => {
    // The control for the ones above: an injectable set that failed to apply
    // would leave them reading the workspace and passing for the wrong reason.
    // Long enough to keep an opening, since a name that shares fewer than four
    // leading characters is not read as a misspelling at all.
    expect(misspelledExport("Zzzzy", new Set(["Zzzzz"]))).toBe(true);
    expect(misspelledExport("NextlyEror", new Set())).toBe(false);
  });
});

describe("a missing name in object shorthand", () => {
  // `{ Page }` is the same missing name as `Page`, and TypeScript reports it as
  // TS18004 rather than TS2304. Reading only TS2304 meant the same reader-owned
  // name was charged or set aside according to the punctuation around it.
  const shorthand = name =>
    `docs/x.mdx#0  #0:1  error TS18004: No value exists in scope for the ` +
    `shorthand property '${name}'. Either declare one or provide an initializer.`;
  const samples = [
    {
      file: "docs/x.mdx",
      index: 0,
      code: "export const components = { Page, baseUrl };",
      lang: "ts",
    },
  ];

  it("answers for both spellings, everywhere the answer is needed", () => {
    // One place, because three asked the same question and they drifted: the
    // classifier learned the shorthand first, then the rebuild, while the
    // survivor pass still read TS2304 alone. A rebased shorthand was dropped as
    // already-reported and its continuation stayed excused without ever having
    // been recompiled.
    expect(
      nameIn("docs/x.mdx#0  #0:1  error TS2304: Cannot find name 'Page'.")
    ).toBe("Page");
    expect(nameIn(shorthand("Page"))).toBe("Page");
    // The control: a diagnostic about something else names nothing missing, so
    // the two above are the pattern matching rather than the string.
    expect(
      nameIn(
        "docs/x.mdx#0  #0:1  error TS2322: Type 'a' is not assignable to type 'b'."
      )
    ).toBeUndefined();
  });

  it("hands a shorthand name to the rebuild like any other", () => {
    // A continuation is excused on the strength of being recompiled with the
    // declaration it inherited. Collecting only TS2304 names for that rebuild
    // excused a shorthand without ever recompiling it, so whatever the pasted
    // declaration would have revealed stayed behind an unresolved `any`.
    const collected = lines => [...namesToRebuild(lines).values()].flat();
    expect(collected([shorthand("Page")])).toEqual(["Page"]);
    // The control: the spelling this always collected still arrives, so the
    // assertion above is the new branch and not the old one.
    expect(
      collected(["docs/y.mdx#1  #1:1  error TS2304: Cannot find name 'Page'."])
    ).toEqual(["Page"]);
  });

  it("is read the way the same name is read anywhere else", async () => {
    const { readerNames, real } = await classifyDocDiagnostics({
      diagnostics: [shorthand("Page"), shorthand("baseUrl")],
      samples,
    });
    const named = lines => lines.map(l => /property '([^']+)'/.exec(l)[1]);
    // The reader's own component, set aside.
    expect(named(readerNames)).toEqual(["Page"]);
    // The separating control: a lowercase shorthand is an unfinished example,
    // and stays a finding, so this is a rule about ownership rather than a
    // blanket exemption for the syntax.
    expect(named(real)).toEqual(["baseUrl"]);
  });
});

describe("a diagnostic whose block cannot be found", () => {
  it("keeps its finding rather than reading the name alone", () => {
    // Two of the three tests need the block, so answering from the name alone
    // was the permissive direction: a constructed name and a misspelled export
    // would both have been set aside there.
    expect(mentionIsReaderOwned("Posts", "docs/nope.mdx", 0, [])).toBe(false);
    // The control: with the block present the same name is the reader's, so
    // the line above is the fallback answering and not the rule.
    expect(
      mentionIsReaderOwned("Posts", "docs/a.mdx", 0, [
        {
          file: "docs/a.mdx",
          index: 0,
          code: "const c = [Posts];",
          lang: "ts",
        },
      ])
    ).toBe(true);
  });
});

describe("how a block used a name", () => {
  it("tells a value position from a type position", () => {
    expect(usedOnlyAsValue("const a = [Media];", "Media", "ts")).toBe(true);
    expect(usedOnlyAsValue("declare const m: Media;", "Media", "ts")).toBe(
      false
    );
    // `typeof X` is written in a type position and reads X out of the VALUE
    // namespace, so it is a value use however it looks. This assertion used to
    // record the opposite.
    expect(usedOnlyAsValue("type X = typeof Media;", "Media", "ts")).toBe(true);
  });

  it("keeps the finding when a block uses the name both ways", () => {
    // The loud direction. Setting it aside would silence the type reference,
    // which is one a reader would meet.
    expect(usedOnlyAsValue("const m: Media = Media;", "Media", "ts")).toBe(
      false
    );
  });

  it("answers no for a name the block never mentions", () => {
    // The control for the two above: `mentioned` is load-bearing, so an absent
    // name cannot read as a value use.
    expect(usedOnlyAsValue("const a = 1;", "Media", "ts")).toBe(false);
  });
});

describe("the population includes package and template READMEs", () => {
  const samples = collectDocSamples();

  it("collects samples at all, so the checks below are not vacuous", () => {
    // The control. An absence assertion over a list that came back empty
    // passes perfectly, and this one reads the filesystem.
    expect(samples).not.toBeNull();
    expect(samples.length).toBeGreaterThan(100);
  });

  it("reads a README, which nothing compiled before", () => {
    // A README is the first code a reader copies: `check-docs-compile` reads
    // `docs/` and so did this gate, so package install and usage examples were
    // the only ones no gate had an opinion about. Named rather than counted,
    // because a count agrees with itself while the walk quietly stops
    // descending.
    const files = new Set(samples.map(s => s.file));
    expect(files).toContain("packages/nextly/README.md");
    expect(files).toContain("packages/plugin-sdk/README.md");
  });

  it("reads a TEMPLATE README too, which is a separate root", () => {
    // `templates/` is walked by its own loop, so a package README arriving
    // says nothing about whether templates do.
    const files = [...new Set(samples.map(s => s.file))];
    expect(files.some(f => f.startsWith("templates/"))).toBe(true);
  });

  it("still reads the docs pages, which the READMEs must not displace", () => {
    // The other direction. A collector rewritten to return only READMEs
    // satisfies both cases above and silently drops 51 pages of coverage.
    const files = [...new Set(samples.map(s => s.file))];
    expect(files.some(f => f.startsWith("docs/"))).toBe(true);
  });
});
