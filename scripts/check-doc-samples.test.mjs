import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  compareToBaseline,
  compile,
  contextOnlyWorthRecording,
  declaredNamesIn,
  extensionFor,
  extractFrom,
  identityOf,
  isModule,
  pageOf,
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

/** What the baseline held before fences were part of an identity. */
const messageOnly = line => line.slice(line.indexOf("  ") + 2);

/** A fingerprint keyed the old way, for the control side of each comparison. */
const fingerprintBy = (key, byFile) =>
  Object.fromEntries(
    Object.entries(byFile).map(([file, lines]) => {
      const counts = {};
      for (const line of lines) counts[key(line)] = (counts[key(line)] ?? 0) + 1;
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
    const before = identityOf("docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.");
    const after = identityOf("docs/a.mdx#3:40  error TS2304: Cannot find name 'Post'.");

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

    expect(appeared).toEqual(["docs/a.mdx: #7 error TS2304: Cannot find name 'Post'."]);
    expect(gone).toEqual(["docs/a.mdx: #3 error TS2304: Cannot find name 'Post'."]);
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
          "docs/a.mdx": { "#3 error TS2551: Property 'sizes' does not exist.": 1 },
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
          findings: { "docs/a.mdx": { "#3 error TS2304: Cannot find name 'Post'.": 1 } },
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

      expect(appeared).toEqual(["docs/a.mdx: #4 error TS2304: Cannot find name 'Page'."]);
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
    expect(pageOf("docs/a.mdx#3:12  error TS2304: Cannot find name 'Post'.")).toBe(
      "docs/a.mdx"
    );
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
    const code = ["function setup() {", "  // closes here: }", "  const hidden = 1;", "}"].join(
      "\n"
    );

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
  const body = 'import { defineConfig } from "nextly";\nexport default defineConfig({});';

  it("reads a tilde-fenced TypeScript block", () => {
    // CommonMark allows `~~~`. Recognising only backticks made such a block
    // invisible to extraction, so publishing one that does not compile lowered
    // no coverage number and passed.
    const samples = extractFrom("markdown-dir", `~~~ts\n${body}\n~~~\n`, "docs/a.mdx");

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
      /^\s*import\b/m.test(c) || /^\s*export\b/m.test(c) || /(?:^|[^.\w])require\s*\(/m.test(c);
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
      unterminatedFences(["```ts", body, "", "prose that never closes"].join("\n"))
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
    expect(unterminatedFences(["```bash", "echo hi", "", "prose"].join("\n"))).toEqual([]);
  });

  it("reports an unclosed tilde fence too", () => {
    expect(unterminatedFences(["~~~ts", body, "", "prose"].join("\n"))).toEqual(["~~~ts"]);
  });
});

describe("extensionFor", () => {
  const jsx = "const a = <div />;";

  it("lets a stated .ts filename beat an inference from the body", () => {
    // A fence headed `ts title="nextly.config.ts"` names the file a reader
    // pastes into. Compiling it as tsx because it holds an angle bracket
    // checks it under rules that reader never gets.
    expect(extensionFor({ lang: "ts", meta: ' title="nextly.config.ts"', code: jsx })).toBe("ts");
    expect(extensionFor({ lang: "ts", meta: ' title="app/page.tsx"', code: jsx })).toBe("tsx");
  });

  it("infers from the body when no filename is stated", () => {
    expect(extensionFor({ lang: "ts", meta: "", code: jsx })).toBe("tsx");
    expect(extensionFor({ lang: "ts", meta: "", code: "const a = 1;" })).toBe("ts");
  });

  it("ignores a stated filename on a rebuilt sample", () => {
    // A rebuilt sample carries the original fence's metadata while being a
    // concatenation that title does not describe. Forcing `.ts` on one whose
    // pasted prefix holds JSX makes it fail to parse for a reason the page
    // does not have.
    expect(
      extensionFor({ lang: "ts", meta: ' title="nextly.config.ts"', code: jsx, prependedLines: 4 })
    ).toBe("tsx");
  });
});

describe("declaredNamesIn and imports that are not declarations", () => {
  it("does not bind a name from an import inside a block comment", () => {
    const code = ["/*", 'import { ghost } from "pkg";', "*/", "const real = 1;"].join("\n");

    expect(declaredNamesIn(code)).toEqual(["real"]);
    // The control: the pattern this replaced read the raw text and could not
    // tell a comment from a statement, so a later fence using `ghost` was
    // excused as a continuation of a page that never bound it.
    const byPattern = [...code.matchAll(/^\s*import\s+([^;]*?)\s+from\s/gms)].length;
    expect(byPattern).toBe(1);
  });

  it("still binds every form a real import declares", () => {
    // A parser swap can quietly lose a shape, so all four are asserted.
    const wrapped = ["import {", "  defineConfig,", "  type Foo,", '} from "nextly";'].join("\n");
    expect(declaredNamesIn(wrapped).sort()).toEqual(["Foo", "defineConfig"]);
    expect(declaredNamesIn('import D, * as NS from "p";').sort()).toEqual(["D", "NS"]);
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
    ['// dynamically import("nextly")\nconst a = { b: 1 };', false, "a mention in a comment"],
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
  const code = ['const id = <T>(x: T) => x;', 'import { defineConfig } from "nextly";'].join("\n");

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
    const withSurplus = { ...complete, uninstalled: 0, real: complete.real + 1 };
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
    expect(unterminatedFences(["```ts", "const a = 1;", "```", ""].join("\n"))).toEqual([]);
    expect(unterminatedFences(["```ts", "const a = 1;", "```   ", ""].join("\n"))).toEqual([]);
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

  it("compiles a fence that only exports a namespace", () => {
    // `export as namespace X` parses as a NamespaceExportDeclaration, which no
    // kind in the list matched, so such a fence was never compiled and carried
    // whatever else it said into the baseline unread. TypeScript's own error
    // for it, TS1314, says the syntax may only appear in a module file.
    const code = "export as namespace Nextly;\ndeclare const a: number;\n";
    expect(isModule(code, "ts")).toBe(true);
    expect(byKindList(code)).toBe(false);
  });

  it("compiles a fence whose only module syntax is import.meta", () => {
    // TypeScript sets its module indicator for `import.meta`, so this fence is
    // a module to the compiler that would compile it while the list read it as
    // a fragment. Neither the reviewer nor the list found this one.
    const code = 'const here = import.meta.url;\nconsole.log(here);\n';
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
    const result = rebaseContextDiagnostics({ lines: [line], prependedByOrigin });
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

describe("a declaration fence keeps declaration-file grammar", () => {
  const declaration = [
    "export as namespace Nextly;",
    "",
    "export interface Thing {",
    "  a: string;",
    "}",
  ].join("\n");

  it("writes a .d.ts fence as one", () => {
    expect(extensionFor({ meta: 'title="index.d.ts"', lang: "ts", code: "" })).toBe(
      "d.ts"
    );
    // The control: the pattern this replaced stopped at `.ts`, so the file went
    // to the compiler under the wrong grammar.
    expect('title="index.d.ts"'.match(/\.(tsx?)\b/)?.[1]).toBe("ts");
    // And the ordinary cases still answer as they did.
    expect(
      extensionFor({ meta: 'title="nextly.config.ts"', lang: "ts", code: "" })
    ).toBe("ts");
    expect(
      extensionFor({ meta: 'title="app/page.tsx"', lang: "tsx", code: "" })
    ).toBe("tsx");
  });

  it("compiles a namespace export clean in a declaration file", () => {
    // Driven through the real compile rather than the predicate, because the
    // predicate cannot say what TypeScript does with the file afterwards.
    const asDeclaration = compile(
      [
        {
          file: "docs/example.mdx",
          index: 0,
          lang: "ts",
          meta: 'title="index.d.ts"',
          code: declaration,
        },
      ],
      "test-declaration"
    );
    expect(asDeclaration).toEqual([]);
  });

  it("still reports a namespace export outside a declaration file", () => {
    // The control on the control: the syntax is not merely tolerated
    // everywhere. Without the title the fence is an ordinary `.ts`, and
    // TypeScript's own error says the syntax belongs to declaration files.
    const asScript = compile(
      [
        {
          file: "docs/example.mdx",
          index: 0,
          lang: "ts",
          meta: "",
          code: declaration,
        },
      ],
      "test-not-a-declaration"
    );
    expect(asScript.join("\n")).toContain("TS1315");
  });
});

describe("withEarlierContext says which fence each pasted line came from", () => {
  const page = [
    { file: "docs/p.mdx", index: 0, lang: "ts", code: "const first = 1;\nconst unused = 2;" },
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
    expect(new Set(firstPass.map(messageOf)).has(messageOf(contextOnly[0]))).toBe(
      true
    );
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

  it("records a block pasted into several continuations once", () => {
    const contextOnly = [missingFoo("docs/a.mdx#1", 3), missingFoo("docs/a.mdx#1", 3)];
    expect(contextOnlyWorthRecording({ contextOnly, firstPass: [] })).toHaveLength(1);
  });
});
