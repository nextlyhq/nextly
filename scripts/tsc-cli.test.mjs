// How tsc-cli reads the compiler's output, on output whose answer is known, and
// how it tells a compiler that answered from one that could not be asked.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile, diagnosticsIn, tscMajor } from "./tsc-cli.mjs";

describe("reading --pretty false output", () => {
  it("reads each diagnostic's file, position, code and message, with its continuation lines", () => {
    const output = [
      "src\\a.ts(3,14): error TS2322: Type 'string' is not assignable to type 'number'.",
      "  The expected type comes from property 'x'.",
      "src/b.ts(10,1): error TS2304: Cannot find name 'y'.",
      "error TS5023: Unknown compiler option '--bogus'.",
      "",
      "Found 3 errors in 2 files.",
    ].join("\n");
    expect(diagnosticsIn(output)).toEqual([
      {
        file: "src/a.ts",
        line: 3,
        column: 14,
        code: "TS2322",
        message:
          "Type 'string' is not assignable to type 'number'.\nThe expected type comes from property 'x'.",
        // As printed: the indentation is the step's depth in the chain.
        chain: ["  The expected type comes from property 'x'."],
      },
      {
        file: "src/b.ts",
        line: 10,
        column: 1,
        code: "TS2304",
        message: "Cannot find name 'y'.",
        chain: [],
      },
      {
        file: undefined,
        line: undefined,
        column: undefined,
        code: "TS5023",
        message: "Unknown compiler option '--bogus'.",
        chain: [],
      },
    ]);
  });

  it("finds nothing in output with no diagnostic", () => {
    expect(diagnosticsIn("/a/lib.d.ts\n/a/src/index.ts\n")).toEqual([]);
  });
});

describe("asking the installed compiler", () => {
  it("names its major version", () => {
    expect(tscMajor()).toBeGreaterThanOrEqual(5);
  });

  it("answers with the diagnostics of a file that does not compile", () => {
    const dir = mkdtempSync(join(tmpdir(), "tsc-cli-"));
    try {
      writeFileSync(join(dir, "a.ts"), 'export const a: number = "x";\n');
      expect(
        compile(["--strict", "a.ts"], dir).map(d => [d.file, d.line, d.code])
      ).toEqual([["a.ts", 1, "TS2322"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to read a run that failed without a diagnostic as a clean result", () => {
    // A compiler that dies printing nothing: its silence is not "no errors".
    const dir = mkdtempSync(join(tmpdir(), "tsc-cli-"));
    const previous = process.env.NEXTLY_TSC;
    try {
      writeFileSync(join(dir, "silent-tsc.mjs"), "process.exit(2);\n");
      process.env.NEXTLY_TSC = join(dir, "silent-tsc.mjs");
      expect(() => compile(["a.ts"], dir)).toThrow(
        /failed with no diagnostics/
      );
    } finally {
      if (previous === undefined) delete process.env.NEXTLY_TSC;
      else process.env.NEXTLY_TSC = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
