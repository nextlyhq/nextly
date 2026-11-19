/**
 * Every command that reads the app's collections, Singles and field groups judges the
 * configuration with the one set of rules before it does anything else. Given the same invalid
 * configuration, each ends with the same report and leaves the project as it found it: no file
 * written, and no database opened (the SQLite file the environment names is never created).
 *
 * Given a project with no configuration file, each of them refuses with the places it looked,
 * while a command that reads none of them goes on with the default configuration.
 *
 * Run in-process through the program the `nextly` binary runs, with the configuration's bundle
 * stubbed, as `config-gate.test.ts` does: everything under test runs after it.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache } from "../utils/config-loader";

const exported = vi.hoisted(() => ({ config: {} as unknown }));

vi.mock("../utils/config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: exported.config },
    dependencies: [],
  }),
}));

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { createProgram } = await import("../program");
const { createAdapter } = await import("../../database/factory");
const { registerServices, shutdownServices } = await import(
  "../../di/register"
);
const { reloadNextlyConfig } = await import("../../init/reload-config");

/** The commands that read the app's entities, each as it is typed after `nextly`. */
const READ_ENTITIES: ReadonlyArray<readonly string[]> = [
  ["generate:types"],
  ["migrate:check"],
  ["migrate:create", "--name", "add_notes"],
  ["migrate:status"],
  ["migrate"],
  ["migrate:baseline"],
  ["migrate:resolve", "--applied", "0001_init.sql"],
  ["migrate:fresh"],
  ["db:sync"],
  ["build"],
  ["prune"],
  ["i18n:restore", "--collection", "notes"],
  ["workflow:stranded"],
  ["upgrade", "--reconcile-core"],
  ["media", "reindex-usage"],
];

/** Three problems in two collections: a slug with a space, a field named twice, a type nothing offers. */
const THREE_PROBLEMS = {
  collections: [
    { slug: "Blog Posts", fields: [{ name: "title", type: "text" }] },
    {
      slug: "notes",
      fields: [
        { name: "body", type: "text" },
        { name: "body", type: "text" },
        { name: "score", type: "acme-rating" },
      ],
    },
  ],
};

/** Thrown in place of `process.exit`, so a command's end can be observed in-process. */
class Exited extends Error {
  constructor(readonly status: number | undefined) {
    super(`exited ${String(status)}`);
  }
}

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-every-command-")));
  clearConfigCache();
  vi.stubEnv("CI", "");
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", `file:${join(dir, "site.db")}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearConfigCache();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** What `nextly <args>` ends with in `dir`: its exit status, and what it wrote to stderr. */
async function run(
  args: readonly string[]
): Promise<{ status: number | undefined; stderr: string }> {
  const written: string[] = [];
  // A command may move into the project (`media` does); the run puts the process back after.
  const home = process.cwd();
  vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    written.push(`${parts.map(String).join(" ")}\n`);
  });
  // The first exit ends the command, as it would the process: what a wrapper prints on catching
  // the stand-in thrown here is not the command's output, so the output stops at that exit.
  let firstExit: { status: number | undefined; written: number } | undefined;
  vi.spyOn(process, "exit").mockImplementation(code => {
    const status = typeof code === "number" ? code : undefined;
    firstExit ??= { status, written: written.length };
    throw new Exited(status);
  });
  // Run from the project, as a command is: one that guards against running from elsewhere asks.
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  process.exitCode = undefined;
  let status: number | undefined;
  try {
    await createProgram()
      .exitOverride()
      .parseAsync(["node", "nextly", ...args, "--cwd", dir]);
    status = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
    status = error.status;
  } finally {
    vi.restoreAllMocks();
    process.chdir(home);
  }
  if (firstExit !== undefined) {
    return {
      status: firstExit.status,
      stderr: written.slice(0, firstExit.written).join(""),
    };
  }
  return { status, stderr: written.join("") };
}

describe("an invalid configuration, given to every command that reads its entities", () => {
  it("is refused alike by each, with the same report, writing nothing", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    exported.config = THREE_PROBLEMS;
    const reports = new Map<string, string>();
    // Each departure is named, so one run shows every command that does not refuse alike.
    const wrong: string[] = [];

    for (const args of READ_ENTITIES) {
      const ran = await run(args);
      const name = args.join(" ");
      const first = ran.stderr.trim().split("\n")[0] ?? "";

      if (ran.status !== 1) wrong.push(`${name}: exit ${String(ran.status)}`);
      if (
        !ran.stderr.includes("CONFIG_INVALID") ||
        !/3 problems/.test(ran.stderr)
      ) {
        wrong.push(`${name}: ${first}`);
      }
      reports.set(name, ran.stderr.trim());
      // Nothing written, and no database opened.
      const left = readdirSync(dir).filter(file => file !== "nextly.config.ts");
      if (left.length > 0) wrong.push(`${name}: wrote ${left.join(", ")}`);
    }

    const [report] = reports.values();
    for (const [name, each] of reports) {
      if (each !== report) wrong.push(`${name}: a different report`);
    }
    expect(wrong).toEqual([]);
    expect(existsSync(join(dir, "site.db"))).toBe(false);
  }, 300_000);
});

describe("a project with no configuration file", () => {
  it("is refused by every command that reads its entities, naming where it looked", async () => {
    const wrong: string[] = [];

    for (const args of READ_ENTITIES) {
      const ran = await run(args);
      const name = args.join(" ");

      if (ran.status !== 1 || !ran.stderr.includes("CONFIG_MISSING")) {
        const first = ran.stderr.trim().split("\n")[0] ?? "";
        wrong.push(`${name}: exit ${String(ran.status)} ${first}`);
      }
      const left = readdirSync(dir);
      if (left.length > 0) wrong.push(`${name}: wrote ${left.join(", ")}`);
    }

    expect(wrong).toEqual([]);
  }, 300_000);

  // `generate:manifest` loads the configuration for its plugins alone, so with none it goes on
  // with the default configuration: there is no plugin, and no manifest to write.
  it("is no reason for a command that reads none of them to refuse", async () => {
    const ran = await run(["generate:manifest"]);

    expect(ran.stderr).not.toContain("CONFIG_MISSING");
    expect(ran.status, ran.stderr).toBe(0);
  });
});

describe("an invalid configuration, saved while the development server runs", () => {
  afterEach(async () => {
    await shutdownServices();
  });

  // The reload a save starts reads the configuration through the same loader, so it is refused by
  // the same rules, keeps the configuration it had, and the terminal is told what a command would
  // say.
  it("is refused by the reload, with the report a command prints", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    exported.config = THREE_PROBLEMS;
    const command = await run(["generate:types"]);

    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    await registerServices({
      adapter,
      collections: [],
    } as unknown as Parameters<typeof registerServices>[0]);
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warned.push(parts.map(String).join(" "));
    });
    vi.spyOn(process, "cwd").mockReturnValue(dir);

    await reloadNextlyConfig();

    const report = command.stderr.trim();
    expect(report).toContain("CONFIG_INVALID");
    expect(
      warned.some(message => message.includes(report)),
      warned.join("\n---\n")
    ).toBe(true);
  }, 120_000);
});
