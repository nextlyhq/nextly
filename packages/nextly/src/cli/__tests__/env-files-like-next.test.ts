/**
 * The environment files the CLI reads, judged against Next.js's own loader.
 *
 * Each case is a project folder with its own files, read twice, each time in a
 * fresh process: once by the CLI's environment step followed by the database
 * check every command makes, and once by `@next/env` for the same folder and
 * mode, as `next dev`, `next build` or a test runner reads it. A fresh process
 * each time, because the loader keeps what it read for the life of the process.
 *
 * The URL Next.js resolves is the reference, and each case also names the URL
 * it expects, so a reference that read nothing cannot agree with a CLI that
 * read nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mode = "development" | "production" | "test";

const here = (file: string) =>
  pathToFileURL(fileURLToPath(new URL(file, import.meta.url))).href;
const ENVIRONMENT = here("../environment.ts");
const PROGRAM = here("../program.ts");
const ADAPTER = here("../utils/adapter.ts");
const requireHere = createRequire(import.meta.url);
const NEXT_ENV = requireHere.resolve("@next/env");
// The TypeScript loader, by its location here: a child runs in the project
// folder, which has no `node_modules` of its own to find it in.
const TSX = pathToFileURL(
  join(dirname(requireHere.resolve("tsx/package.json")), "dist/loader.mjs")
).href;

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A project folder holding `files`, name to `DATABASE_URL` value. */
function project(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "nextly-env-files-"));
  folders.push(folder);
  for (const [name, url] of Object.entries(files)) {
    writeFileSync(join(folder, name), `DATABASE_URL=${url}\n`);
  }
  return folder;
}

/**
 * The environment a child starts with: this process's, without the variables
 * a case decides, then `NODE_ENV` and `DATABASE_URL` as the case gives them.
 */
function childEnv(
  nodeEnv: string | undefined,
  databaseUrl?: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // By name, as any variable: `NODE_ENV` is typed as always set, which a
  // child started without it is not.
  const decided: Record<string, string | undefined> = {
    NODE_ENV: nodeEnv,
    DATABASE_URL: databaseUrl,
    DB_DIALECT: undefined,
    __NEXT_PROCESSED_ENV: undefined,
  };
  for (const [name, value] of Object.entries(decided)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

interface CliReading {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  printed: string[];
}

/**
 * What the CLI reads in `folder` for `argv`: the program as the entry point
 * builds it, with its environment step, parses `argv` and runs `probe`, a
 * command that checks the database settings twice, as a command that
 * validates them more than once does, with the mode line captured. Commander
 * reads `--mode`, so every form it accepts reaches the environment step as it
 * reaches a command.
 */
function cliReads(
  folder: string,
  argv: string[],
  env: NodeJS.ProcessEnv
): CliReading {
  const script = `
    const { loadProgramEnvironment, setModeLineWriter } = await import(${JSON.stringify(ENVIRONMENT)});
    const { createProgram } = await import(${JSON.stringify(PROGRAM)});
    const { validateDatabaseEnv } = await import(${JSON.stringify(ADAPTER)});
    const printed = [];
    const program = createProgram({ beforeAction: loadProgramEnvironment });
    program.command("probe").allowExcessArguments().action(() => {
      setModeLineWriter(line => printed.push(line));
      validateDatabaseEnv();
      validateDatabaseEnv();
    });
    await program.parseAsync(${JSON.stringify(["node", "nextly", ...argv])});
    process.stdout.write(JSON.stringify({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
      printed,
    }));
  `;
  const out = execFileSync(
    process.execPath,
    ["--import", TSX, "--input-type=module", "--eval", script],
    {
      cwd: folder,
      env: { ...env, NEXTLY_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
    }
  );
  return JSON.parse(out) as CliReading;
}

/** The `DATABASE_URL` Next.js's loader resolves in `folder` for `mode`. */
function nextReads(folder: string, mode: Mode, databaseUrl?: string): string {
  const script = `
    const { loadEnvConfig } = require(${JSON.stringify(NEXT_ENV)});
    loadEnvConfig(process.cwd(), ${JSON.stringify(mode === "development")}, { info() {}, error() {} });
    process.stdout.write(process.env.DATABASE_URL ?? "");
  `;
  return execFileSync(process.execPath, ["--eval", script], {
    cwd: folder,
    env: childEnv(mode, databaseUrl),
    encoding: "utf8",
  });
}

const perMode = {
  ".env": "file:./from-env.db",
  ".env.development": "file:./development.db",
  ".env.production": "file:./production.db",
  ".env.test": "file:./test.db",
};

describe("the environment files the CLI reads, as Next.js reads them", () => {
  it("`.env.local` wins over `.env`", () => {
    const folder = project({
      ".env": "file:./from-env.db",
      ".env.local": "file:./from-env-local.db",
    });
    const cli = cliReads(folder, ["probe"], childEnv(undefined));
    expect(cli.databaseUrl).toBe(nextReads(folder, "development"));
    expect(cli.databaseUrl).toBe("file:./from-env-local.db");
    expect(cli.printed).toEqual([
      "Mode: development (DATABASE_URL from .env.local)",
    ]);
  });

  it("the process environment wins over every file", () => {
    const folder = project({
      ".env": "file:./from-env.db",
      ".env.local": "file:./from-env-local.db",
      ".env.development": "file:./development.db",
      ".env.development.local": "file:./development-local.db",
    });
    const cli = cliReads(
      folder,
      ["probe"],
      childEnv(undefined, "file:./from-process.db")
    );
    expect(cli.databaseUrl).toBe(
      nextReads(folder, "development", "file:./from-process.db")
    );
    expect(cli.databaseUrl).toBe("file:./from-process.db");
    expect(cli.printed).toEqual([
      "Mode: development (DATABASE_URL from the process environment)",
    ]);
  });

  it.each([
    [undefined, "development"],
    ["production", "production"],
    ["test", "test"],
    // Anything else is development, as Next.js's loader reads it.
    ["staging", "development"],
  ] as const)(
    "with NODE_ENV %s, runs in %s mode and reads that mode's file",
    (nodeEnv, mode) => {
      const folder = project(perMode);
      const cli = cliReads(folder, ["probe"], childEnv(nodeEnv));
      expect(cli.databaseUrl).toBe(nextReads(folder, mode));
      expect(cli.databaseUrl).toBe(`file:./${mode}.db`);
      expect(cli.nodeEnv).toBe(mode);
      expect(cli.printed).toEqual([
        `Mode: ${mode} (DATABASE_URL from .env.${mode})`,
      ]);
    }
  );

  it("--mode overrides NODE_ENV", () => {
    const folder = project(perMode);
    const cli = cliReads(
      folder,
      ["probe", "--mode", "production"],
      childEnv("test")
    );
    expect(cli.databaseUrl).toBe(nextReads(folder, "production"));
    expect(cli.databaseUrl).toBe("file:./production.db");
    // The configuration is evaluated in this process after this point, so it
    // sees the chosen mode, not the one the shell set.
    expect(cli.nodeEnv).toBe("production");
    expect(cli.printed).toEqual([
      "Mode: production (DATABASE_URL from .env.production)",
    ]);
  });

  // Every form Commander accepts, read from its one option definition: the
  // files are the ones the mode Commander parsed names.
  it("reads --mode=<mode> written as one argument, the last of several, and none after `--`", () => {
    const folder = project(perMode);
    expect(
      cliReads(folder, ["--mode=test", "probe"], childEnv("production")).printed
    ).toEqual(["Mode: test (DATABASE_URL from .env.test)"]);
    expect(
      cliReads(
        folder,
        ["probe", "--mode", "production", "--mode=test"],
        childEnv(undefined)
      ).printed
    ).toEqual(["Mode: test (DATABASE_URL from .env.test)"]);
    expect(
      cliReads(
        folder,
        ["probe", "--", "--mode", "production"],
        childEnv(undefined)
      ).printed
    ).toEqual(["Mode: development (DATABASE_URL from .env.development)"]);
  });

  it("names a database URL no file and no variable sets", () => {
    const cli = cliReads(project({}), ["probe"], childEnv(undefined));
    expect(cli.databaseUrl).toBeUndefined();
    expect(cli.printed).toEqual(["Mode: development (DATABASE_URL not set)"]);
  });

  // `nextly plugins install`, a step of the build script, connects without
  // the settings check first; it names its mode all the same.
  it("prints the mode line for a command that connects without checking first", () => {
    const script = `
      const { loadCliEnvironment, setModeLineWriter } = await import(${JSON.stringify(ENVIRONMENT)});
      const { createCliAdapter } = await import(${JSON.stringify(ADAPTER)});
      loadCliEnvironment("production");
      const printed = [];
      setModeLineWriter(line => printed.push(line));
      // No URL anywhere, so it refuses before connecting.
      await createCliAdapter({}).catch(() => {});
      process.stdout.write(JSON.stringify(printed));
    `;
    const out = execFileSync(
      process.execPath,
      ["--import", TSX, "--input-type=module", "--eval", script],
      { cwd: project({}), env: childEnv(undefined), encoding: "utf8" }
    );
    expect(JSON.parse(out)).toEqual([
      "Mode: production (DATABASE_URL not set)",
    ]);
  });
});

describe("the --mode option and the mode line, through the program", () => {
  // A fresh copy of the CLI's modules for each case: the mode line is printed
  // once a run, and a run here is one case.
  async function freshProgram() {
    vi.resetModules();
    const environment = await import("../environment");
    const { createProgram } = await import("../program");
    const program = createProgram({
      beforeAction: parsed =>
        environment.loadProgramEnvironment(parsed, project({})),
    })
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} });
    program.command("probe").action(() => environment.announceMode());
    return { environment, program };
  }

  /** Runs `argv` with the program's environment loaded from an empty folder. */
  async function run(argv: string[]) {
    const { program } = await freshProgram();
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      stderr.push(String(chunk));
      return true;
    });
    try {
      await program.parseAsync(["node", "nextly", ...argv]);
    } finally {
      vi.mocked(process.stdout.write).mockRestore();
      vi.mocked(process.stderr.write).mockRestore();
    }
    return { program, stdout, stderr };
  }

  beforeEach(() => {
    vi.stubEnv("NEXTLY_TELEMETRY_DISABLED", "1");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "file:./probe.db");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts --mode after the command, as every global option is", async () => {
    const { program, stderr } = await run(["probe", "--mode", "production"]);
    expect(program.opts().mode).toBe("production");
    expect(stderr.join("")).toBe(
      "Mode: production (DATABASE_URL from the process environment)\n"
    );
  });

  it("prints the mode line on stderr, leaving stdout to the command", async () => {
    const { stdout, stderr } = await run(["probe"]);
    expect(stderr.join("")).toBe(
      "Mode: test (DATABASE_URL from the process environment)\n"
    );
    expect(stdout.join("")).not.toContain("Mode:");
  });

  it("prints no mode line under --quiet", async () => {
    const { stdout, stderr } = await run(["--quiet", "probe"]);
    expect(`${stdout.join("")}${stderr.join("")}`).not.toContain("Mode:");
  });

  it("refuses a mode outside the three, naming them", async () => {
    await expect(run(["probe", "--mode", "staging"])).rejects.toMatchObject({
      code: "commander.invalidArgument",
      message: expect.stringContaining(
        "Allowed choices are development, production, test."
      ),
    });
  });
});
