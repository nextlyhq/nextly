/**
 * A workflow naming a stage it does not have refuses to compile, each refusal
 * named.
 *
 * `defineWorkflow` takes its stage names from `stages` alone, so a misspelt
 * stage in a step's `to` or `from`, or in a place a part moves to
 * automatically, is a compile error rather than a name the types quietly
 * widen to accept. Each case is a small file compiled beside the real module
 * in two forms: the FAULTY form must produce exactly one error, on the line
 * marked `/*!*\/`, with the code and words expected; the CORRECTED form, with
 * only the fault put right, must compile with none. The twin is what shows a
 * case reaches the rule at all, rather than failing for a reason the fix does
 * not touch, and naming the error is what `@ts-expect-error` cannot do. As in
 * `domains/widgets/declaration/__tests__/compile-errors.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  compile,
  listedFiles,
  tscMajor,
} from "../../../../../../scripts/tsc-cli.mjs";

// Paths in `/` form on every platform, as TypeScript names a file.
const { dirname, join } = posix;
const here = dirname(fileURLToPath(import.meta.url).replaceAll("\\", "/"));
const packageRoot = join(here, "..", "..", "..", "..");

/** Marks the line a faulty form's one error must be reported on. */
const MARK = "/*!*/";

interface Case {
  name: string;
  faulty: string;
  corrected: string;
  code: number;
  message: string;
  /**
   * What TypeScript 7 reports instead, where it differs. The refusal, its line
   * and its cause are the same.
   */
  typeScript7?: Partial<Pick<Case, "code" | "message">>;
}

/** A sound workflow with one place, `fragment`, written by the case. */
function workflow(fragment: (at: string) => string, value: string): string {
  return `import { defineWorkflow } from "../define-workflow";
export const w = defineWorkflow({
  slug: "editorial",
  label: "Editorial",
  stages: [
    { name: "drafting", label: "Drafting" },
    { name: "inReview", label: "In review" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  ${fragment(value)}
});
`;
}

const steps = (to: string) => `steps: [
    { name: "submit", label: "Submit", kind: "submit", from: "drafting", to: "inReview" },
    { name: "approve", label: "Approve", kind: "approve", from: "inReview", to: ${to}, primary: true }, ${MARK}
    { name: "back", label: "Back", kind: "request-changes", from: "inReview", to: "drafting" },
  ],`;

const fromList = (from: string) => `steps: [
    { name: "submit", label: "Submit", kind: "submit", from: "drafting", to: "inReview" },
    { name: "approve", label: "Approve", kind: "approve", from: ["inReview", ${from}], to: "approved", primary: true }, ${MARK}
    { name: "back", label: "Back", kind: "request-changes", from: "inReview", to: "drafting" },
  ],`;

const automatic = (key: string) => (value: string) => `steps: [
    { name: "submit", label: "Submit", kind: "submit", from: "drafting", to: "inReview" },
    { name: "approve", label: "Approve", kind: "approve", from: "inReview", to: "approved", primary: true },
    { name: "back", label: "Back", kind: "request-changes", from: "inReview", to: "drafting" },
  ],
  ${key}: ${value}, ${MARK}`;

const NOT_A_STAGE = `is not assignable to type '"drafting" | "inReview" | "approved"'`;
// TypeScript 7 writes a union's members in its own order, not as declared.
const NOT_A_STAGE_7 = `is not assignable to type '"approved" | "drafting" | "inReview"'`;

const CASES: readonly Case[] = [
  {
    name: "a step to a misspelt stage",
    faulty: workflow(steps, `"aproved"`),
    corrected: workflow(steps, `"approved"`),
    // The checker names the stage it is closest to.
    code: 2820,
    message: `${NOT_A_STAGE}. Did you mean '"approved"'?`,
    typeScript7: { message: `${NOT_A_STAGE_7}. Did you mean '"approved"'?` },
  },
  {
    name: "a step from a misspelt stage",
    faulty: workflow(fromList, `"inReveiw"`),
    corrected: workflow(fromList, `"inReview"`),
    code: 2322,
    message: NOT_A_STAGE,
    typeScript7: { message: NOT_A_STAGE_7 },
  },
  {
    name: "a misspelt after-publish stage",
    faulty: workflow(automatic("afterPublish"), `"drafitng"`),
    corrected: workflow(automatic("afterPublish"), `"drafting"`),
    code: 2820,
    // An optional field: its type admits leaving it out.
    message: `is not assignable to type '"drafting" | "inReview" | "approved" | undefined'. Did you mean '"drafting"'?`,
    typeScript7: {
      message: `is not assignable to type '"approved" | "drafting" | "inReview" | undefined'. Did you mean '"drafting"'?`,
    },
  },
  {
    name: "a misspelt stage for withdrawn approvals",
    faulty: workflow(automatic("approvalsWithdrawnTo"), `"drafitng"`),
    corrected: workflow(automatic("approvalsWithdrawnTo"), `"drafting"`),
    code: 2820,
    // An optional field: its type admits leaving it out.
    message: `is not assignable to type '"drafting" | "inReview" | "approved" | undefined'. Did you mean '"drafting"'?`,
    typeScript7: {
      message: `is not assignable to type '"approved" | "drafting" | "inReview" | undefined'. Did you mean '"drafting"'?`,
    },
  },
];

/** Where each case's two forms are compiled, as if they sat in this folder. */
function casePath(index: number, form: "faulty" | "corrected"): string {
  return join(here, `case-${index}-${form}.ts`);
}

/** One diagnostic, as a reader of a failure would want it. */
interface CaseDiagnostic {
  line: number | undefined;
  code: number;
  message: string;
}

/** The diagnostics of every case file, compiled together in one program. */
let diagnosticsByFile: Map<string, readonly CaseDiagnostic[]>;

beforeAll(() => {
  const virtual = new Map<string, string>();
  CASES.forEach((c, index) => {
    virtual.set(casePath(index, "faulty"), c.faulty);
    virtual.set(casePath(index, "corrected"), c.corrected);
  });

  // The cases are written to a directory of their own, laid out like this
  // package's `src`, and `rootDirs` merges the two: a case's relative imports
  // reach the real modules as they would from this folder. It sits in the
  // package's `.turbo`, which git and every scan of the tree ignore, so no
  // other suite sees a case come and go; and `rootDir` widens to the package,
  // which holds both. The package's own config is extended, so a case
  // compiles exactly as a file in this folder would under `check-types`.
  const parent = join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, "workflow-cases-")).replaceAll(
    "\\",
    "/"
  );
  const mirror = (path: string) =>
    join(scratch, posix.relative(packageRoot, path));
  try {
    for (const [path, text] of virtual) {
      mkdirSync(dirname(mirror(path)), { recursive: true });
      writeFileSync(mirror(path), text, { flag: "wx" });
    }
    const config = join(scratch, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(packageRoot, "tsconfig.json"),
        compilerOptions: {
          rootDir: packageRoot,
          rootDirs: [join(scratch, "src"), join(packageRoot, "src")],
        },
        files: [...virtual.keys()].map(mirror),
        include: [],
      }),
      { flag: "wx" }
    );

    // Every case is in the program, or its silence would be a skipped case.
    const listed = new Set(listedFiles(config));
    for (const path of virtual.keys()) {
      if (!listed.has(mirror(path))) throw new Error(`Not compiled: ${path}`);
    }

    const diagnostics = compile(["-p", config], scratch);
    // tsc names a file relative to where it runs, or in full outside it.
    const fromScratch = (file: string) =>
      /^([A-Za-z]:)?\//.test(file) ? file : join(scratch, file);
    diagnosticsByFile = new Map(
      [...virtual.keys()].map(path => [
        path,
        diagnostics
          .filter(d => d.file && fromScratch(d.file) === mirror(path))
          .map(d => ({
            line: d.line,
            code: Number(d.code.slice(2)),
            message: d.message,
          })),
      ])
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);

describe("a workflow naming a stage it does not have refuses to compile", () => {
  it("compiles every case, so none is skipped for want of a file", () => {
    expect(diagnosticsByFile.size).toBe(CASES.length * 2);
  });

  CASES.forEach((c, index) => {
    describe(c.name, () => {
      it("fails once, on the marked line, for the named reason", () => {
        const markedLine =
          c.faulty.split("\n").findIndex(line => line.includes(MARK)) + 1;
        expect(markedLine).toBeGreaterThan(0);
        const found = diagnosticsByFile.get(casePath(index, "faulty")) ?? [];
        const expected = tscMajor() >= 7 ? { ...c, ...c.typeScript7 } : c;
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
          line: markedLine,
          code: expected.code,
        });
        expect(found[0]?.message).toContain(expected.message);
      });

      it("compiles once the fault is put right", () => {
        const found = diagnosticsByFile.get(casePath(index, "corrected")) ?? [];
        expect(found).toEqual([]);
      });
    });
  });
});
