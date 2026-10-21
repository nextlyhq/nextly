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
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

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

const CASES: readonly Case[] = [
  {
    name: "a step to a misspelt stage",
    faulty: workflow(steps, `"aproved"`),
    corrected: workflow(steps, `"approved"`),
    // The checker names the stage it is closest to.
    code: 2820,
    message: `${NOT_A_STAGE}. Did you mean '"approved"'?`,
  },
  {
    name: "a step from a misspelt stage",
    faulty: workflow(fromList, `"inReveiw"`),
    corrected: workflow(fromList, `"inReview"`),
    code: 2322,
    message: NOT_A_STAGE,
  },
  {
    name: "a misspelt after-publish stage",
    faulty: workflow(automatic("afterPublish"), `"drafitng"`),
    corrected: workflow(automatic("afterPublish"), `"drafting"`),
    code: 2820,
    // An optional field: its type admits leaving it out.
    message: `is not assignable to type '"drafting" | "inReview" | "approved" | undefined'. Did you mean '"drafting"'?`,
  },
  {
    name: "a misspelt stage for withdrawn approvals",
    faulty: workflow(automatic("approvalsWithdrawnTo"), `"drafitng"`),
    corrected: workflow(automatic("approvalsWithdrawnTo"), `"drafting"`),
    code: 2820,
    // An optional field: its type admits leaving it out.
    message: `is not assignable to type '"drafting" | "inReview" | "approved" | undefined'. Did you mean '"drafting"'?`,
  },
];

/** Where each case's two forms are compiled, as if they sat in this folder. */
function casePath(index: number, form: "faulty" | "corrected"): string {
  return join(here, `case-${index}-${form}.ts`);
}

/** The diagnostics of every case file, compiled together in one program. */
let diagnosticsByFile: Map<string, readonly ts.Diagnostic[]>;

beforeAll(() => {
  const virtual = new Map<string, string>();
  CASES.forEach((c, index) => {
    virtual.set(casePath(index, "faulty"), c.faulty);
    virtual.set(casePath(index, "corrected"), c.corrected);
  });
  // The package's own compiler options, so a case compiles as a file in
  // this folder would under `check-types`.
  const configPath = join(packageRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, path => ts.sys.readFile(path));
  const options = {
    ...ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
      .options,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = path => virtual.has(path) || fileExists(path);
  host.readFile = path => virtual.get(path) ?? readFile(path);
  host.getSourceFile = (path, language, onError, create) => {
    const text = virtual.get(path);
    return text === undefined
      ? getSourceFile(path, language, onError, create)
      : ts.createSourceFile(path, text, language);
  };
  const program = ts.createProgram([...virtual.keys()], options, host);
  diagnosticsByFile = new Map(
    [...virtual.keys()].map(path => {
      const file = program.getSourceFile(path);
      if (file === undefined) throw new Error(`Not compiled: ${path}`);
      return [
        path,
        [
          ...program.getSyntacticDiagnostics(file),
          ...program.getSemanticDiagnostics(file),
        ],
      ];
    })
  );
}, 120_000);

/** One diagnostic, as a reader of a failure would want it. */
function describeDiagnostic(diagnostic: ts.Diagnostic) {
  const { file, start } = diagnostic;
  return {
    line:
      file !== undefined && start !== undefined
        ? file.getLineAndCharacterOfPosition(start).line + 1
        : undefined,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  };
}

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
        const found = (
          diagnosticsByFile.get(casePath(index, "faulty")) ?? []
        ).map(describeDiagnostic);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ line: markedLine, code: c.code });
        expect(found[0]?.message).toContain(c.message);
      });

      it("compiles once the fault is put right", () => {
        const found = (
          diagnosticsByFile.get(casePath(index, "corrected")) ?? []
        ).map(describeDiagnostic);
        expect(found).toEqual([]);
      });
    });
  });
});
