// How tsc-cli reads the compiler's output, on output whose answer is known, and
// how it tells a compiler that answered from one that could not be asked.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkerArgs, compile, diagnosticsIn, tscMajor } from "./tsc-cli.mjs";

describe("the checkers a compiler is given", () => {
  it("gives TypeScript 7 and later this machine's number", () => {
    expect(checkerArgs({ checkers: 2 }, 7)).toEqual(["--checkers", "2"]);
    expect(checkerArgs({ checkers: 1 }, 8)).toEqual(["--checkers", "1"]);
  });

  it("gives a 5.x compiler none, since it refuses the option and checks nothing", () => {
    expect(checkerArgs({ checkers: 2 }, 5)).toEqual([]);
  });
});

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

/**
 * Runs `body` with `NEXTLY_TSC` naming a stand-in compiler of `source`, and
 * `NEXTLY_LOCAL_MAX_WORKERS` at `workers`, restoring both after.
 */
function withStandInTsc(source, workers, body) {
  const dir = mkdtempSync(join(tmpdir(), "tsc-cli-"));
  const previous = {
    NEXTLY_TSC: process.env.NEXTLY_TSC,
    NEXTLY_LOCAL_MAX_WORKERS: process.env.NEXTLY_LOCAL_MAX_WORKERS,
  };
  try {
    writeFileSync(join(dir, "stand-in-tsc.mjs"), source);
    process.env.NEXTLY_TSC = join(dir, "stand-in-tsc.mjs");
    process.env.NEXTLY_LOCAL_MAX_WORKERS = workers;
    return body(dir);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * How a stand-in answers `tsc -v`, which is asked before its checkers are
 * chosen: as the given major version does, so it is run as that compiler.
 */
const answersVersion = major =>
  `if (process.argv[2] === "-v") { console.log("Version ${major}.0.0"); process.exit(0); }\n`;

/** A compiler that answers with one diagnostic naming the arguments it was given. */
const ECHO_ARGS =
  answersVersion(7) +
  'console.log("error TS9999: " + process.argv.slice(2).join(" "));\nprocess.exit(1);\n';

/** The same, as a 5.x compiler. */
const ECHO_ARGS_5 =
  answersVersion(5) +
  'console.log("error TS9999: " + process.argv.slice(2).join(" "));\nprocess.exit(1);\n';

/** A compiler the kernel stops, as it stops one out of memory. */
const KILLED = answersVersion(7) + 'process.kill(process.pid, "SIGKILL");\n';

const WRAPPER = join(import.meta.dirname, "tsc.mjs");

describe("the checkers a compiler is run with", () => {
  // One worker is how a constrained machine is asked for one checker, so the
  // expected `1` is neither the compiler's own default of 4 nor a fixed value.
  it("gives a test's compile() this machine's checkers, not the compiler's default", () => {
    withStandInTsc(ECHO_ARGS, "1", dir => {
      const [diagnostic] = compile(["a.ts"], dir);
      expect(diagnostic.message).toMatch(/(^| )--checkers 1( |$)/);
    });
  });

  it("gives every check-types run, through tsc.mjs, the same checkers", () => {
    withStandInTsc(ECHO_ARGS, "1", dir => {
      const run = spawnSync(process.execPath, [WRAPPER, "--noEmit"], {
        cwd: dir,
        encoding: "utf8",
        env: process.env,
      });
      expect(run.stdout).toMatch(/(^| )--checkers 1( |$)/);
    });
  });

  it("gives a 5.x compiler run through tsc.mjs no checkers, which it would refuse", () => {
    withStandInTsc(ECHO_ARGS_5, "1", dir => {
      const run = spawnSync(process.execPath, [WRAPPER, "--noEmit"], {
        cwd: dir,
        encoding: "utf8",
        env: process.env,
      });
      expect(run.stdout).toContain("error TS9999: --noEmit");
      expect(run.stdout).not.toContain("--checkers");
    });
  });
});

describe("a compiler killed by a signal", () => {
  it("is reported by compile() as a kill, not as a run with no diagnostics", () => {
    withStandInTsc(KILLED, "1", dir => {
      expect(() => compile(["a.ts"], dir)).toThrow(
        /killed by SIGKILL \(out of memory\?\), running 1 type-checking worker/
      );
    });
  });

  it("is reported by tsc.mjs as a kill, and still fails the run", () => {
    withStandInTsc(KILLED, "1", dir => {
      const run = spawnSync(process.execPath, [WRAPPER, "--noEmit"], {
        cwd: dir,
        encoding: "utf8",
        env: process.env,
      });
      expect(run.stderr).toMatch(/killed by SIGKILL \(out of memory\?\)/);
      expect(run.status).toBe(1);
    });
  });
});
