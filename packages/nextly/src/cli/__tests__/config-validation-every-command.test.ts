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

import {
  LOAD_CONFIGURATION,
  NOT_CHECKED,
  READ_ENTITIES,
} from "./helpers/commands-by-configuration";

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
  // What `users:create-admin` takes its password from; it is judged after the configuration.
  vi.stubEnv("NEXTLY_ADMIN_PASSWORD", "Not-a-real-1-password");
  vi.stubEnv("DATABASE_URL", `file:${join(dir, "site.db")}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearConfigCache();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The report a run ends with: what it wrote to stderr from the error shape's
 * first line on. A run starts with its own first line, the database it was
 * about to use or what it was starting, which differs by command and is no
 * part of the report.
 */
function reportOf(stderr: string): string {
  const start = stderr.indexOf("✗");
  return (start === -1 ? stderr : stderr.slice(start)).trim();
}

/** What `nextly <args>` ends with in `dir`: its exit status, and what it wrote to stderr. */
async function run(
  args: readonly string[]
): Promise<{ status: number | undefined; stderr: string }> {
  const written: string[] = [];
  // Each run reads the configuration afresh, as a new process does: the loader's cache is keyed
  // by the file, which the stubbed bundle leaves unchanged between runs.
  clearConfigCache();
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

describe("the commands the program registers", () => {
  interface Registered {
    name(): string;
    commands: readonly Registered[];
  }
  /** Each command that does something, as it is typed: `plugins list`. */
  const typed = (command: Registered, at: readonly string[]): string[] =>
    command.commands.length === 0
      ? [[...at, command.name()].join(" ")]
      : command.commands.flatMap(each => typed(each, [...at, command.name()]));

  it("are each checked for an invalid configuration, or left out with a reason, and once", () => {
    const commands = (
      createProgram() as unknown as Registered
    ).commands.flatMap(each => typed(each, []));
    // The command each line runs; a line that runs none names itself.
    const run = (lines: ReadonlyArray<readonly string[]>) =>
      new Set(
        lines.map(
          line =>
            commands.find(
              command =>
                line.slice(0, command.split(" ").length).join(" ") === command
            ) ?? line.join(" ")
        )
      );
    const lists = [
      run(READ_ENTITIES),
      run(LOAD_CONFIGURATION),
      new Set(NOT_CHECKED.keys()),
    ];

    const wrong: string[] = [];
    for (const command of commands) {
      const times = lists.filter(list => list.has(command)).length;
      if (times !== 1) wrong.push(`${command}: in ${times} lists`);
    }
    for (const listed of lists.flatMap(list => [...list])) {
      if (!commands.includes(listed)) wrong.push(`${listed}: not a command`);
    }
    for (const [command, why] of NOT_CHECKED) {
      if (why === "") wrong.push(`${command}: no reason`);
    }
    expect(wrong).toEqual([]);
    // The program's own commands were found at all.
    expect(commands).toContain("plugins list");
  });
});

describe("an invalid configuration, given to every command that loads it", () => {
  it("is refused alike by each, with the same report, writing nothing", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    exported.config = THREE_PROBLEMS;
    const reports = new Map<string, string>();
    // Each departure is named, so one run shows every command that does not refuse alike.
    const wrong: string[] = [];

    for (const args of [...READ_ENTITIES, ...LOAD_CONFIGURATION]) {
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
      reports.set(name, reportOf(ran.stderr));
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

  // A plugin's own rollback reads its migrations and no app entity, so it goes on without one; it
  // ends for its own reason (no such plugin), never for the missing configuration.
  // A blank migration reads no entity, only the migrations folder, so it is written where the
  // default configuration puts that folder.
  it("is no reason for migrate:create --blank to refuse", async () => {
    const ran = await run(["migrate:create", "--blank", "--name", "by_hand"]);

    expect(ran.stderr).not.toContain("CONFIG_MISSING");
    expect(ran.status, ran.stderr).toBe(0);
  });

  it("is no reason for migrate:down --plugin to refuse", async () => {
    const ran = await run(["migrate:down", "--plugin", "@acme/seo"]);

    expect(ran.stderr).not.toContain("CONFIG_MISSING");
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

    const report = reportOf(command.stderr);
    expect(report).toContain("CONFIG_INVALID");
    expect(
      warned.some(message => message.includes(report)),
      warned.join("\n---\n")
    ).toBe(true);
  }, 120_000);
});

describe("a Builder entity the definition file lost, which a plugin extends", () => {
  // The plugin's extend names an entity the file no longer declares. Restoring the file is the
  // fix, not creating the target: the loss is what each command reports, as `migrate:check` and
  // `migrate:create` report it, rather than an extend target nothing declares.
  it("is refused as lost, not as a missing extend target", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    const definitions = join(dir, "ui-schema.json");
    writeFileSync(
      definitions,
      JSON.stringify({
        collections: [
          { slug: "cases", fields: [{ name: "rating", type: "number" }] },
        ],
        singles: [],
        components: [],
      })
    );
    exported.config = { db: { migrationsDir: "./migrations" } };
    const first = await run(["migrate:create", "--name", "cases"]);
    expect(first.status, first.stderr).toBe(0);

    // The entry removed from the file, and a plugin extending it added.
    writeFileSync(
      definitions,
      JSON.stringify({ collections: [], singles: [], components: [] })
    );
    exported.config = {
      db: { migrationsDir: "./migrations" },
      plugins: [
        {
          name: "@acme/seo",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            extend: [
              { target: "cases", fields: [{ name: "seoTitle", type: "text" }] },
            ],
          },
        },
      ],
    };

    for (const args of [["generate:types"], ["migrate:check"]]) {
      const ran = await run(args);
      const name = args.join(" ");

      expect(ran.status, `${name}\n${ran.stderr}`).toBe(1);
      expect(ran.stderr, name).toContain("BUILDER_DEFINITION_MISSING");
      expect(ran.stderr, name).toContain("collection 'cases'");
      expect(ran.stderr, name).not.toContain("EXTEND_TARGET_UNKNOWN");
    }
  }, 300_000);
});

describe("a Builder entity the definition file lost, which a code relationship names", () => {
  // With no plugin configured, nothing resolves relation targets at load; a code relationship
  // naming the lost entity is still that loss.
  it("is refused as lost with no plugin configured", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    const definitions = join(dir, "ui-schema.json");
    writeFileSync(
      definitions,
      JSON.stringify({
        collections: [
          { slug: "cases", fields: [{ name: "rating", type: "number" }] },
        ],
        singles: [],
        components: [],
      })
    );
    exported.config = { db: { migrationsDir: "./migrations" } };
    const first = await run(["migrate:create", "--name", "cases"]);
    expect(first.status, first.stderr).toBe(0);

    writeFileSync(
      definitions,
      JSON.stringify({ collections: [], singles: [], components: [] })
    );
    exported.config = {
      db: { migrationsDir: "./migrations" },
      collections: [
        {
          slug: "notes",
          fields: [
            { name: "body", type: "text" },
            { name: "matter", type: "relationship", relationTo: "cases" },
          ],
        },
      ],
    };

    const ran = await run(["generate:types"]);

    expect(ran.status, ran.stderr).toBe(1);
    expect(ran.stderr).toContain("BUILDER_DEFINITION_MISSING");
    expect(ran.stderr).toContain("collection 'cases'");
  }, 300_000);

  // A definition file that cannot be read says nothing about what it holds: its own failure is
  // the migrate commands' to report, and no entity is called lost for it.
  it("is not called lost where the definition file cannot be read", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    const definitions = join(dir, "ui-schema.json");
    writeFileSync(
      definitions,
      JSON.stringify({
        collections: [
          { slug: "cases", fields: [{ name: "rating", type: "number" }] },
        ],
        singles: [],
        components: [],
      })
    );
    exported.config = { db: { migrationsDir: "./migrations" } };
    const first = await run(["migrate:create", "--name", "cases"]);
    expect(first.status, first.stderr).toBe(0);

    writeFileSync(definitions, "{ not json");
    exported.config = {
      db: { migrationsDir: "./migrations" },
      plugins: [
        {
          name: "@acme/seo",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            extend: [
              { target: "cases", fields: [{ name: "seoTitle", type: "text" }] },
            ],
          },
        },
      ],
    };

    const ran = await run(["generate:types"]);

    expect(ran.status, ran.stderr).toBe(1);
    expect(ran.stderr).not.toContain("BUILDER_DEFINITION_MISSING");
  }, 300_000);
});

describe("a plugin's extend refused for a reason of its own, beside an unrelated lost entity", () => {
  // Only a target nothing declares may be the lost entity; a field the extend declares twice is
  // its own problem, and is reported as that.
  it("is reported as itself, not as the loss", async () => {
    writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
    const definitions = join(dir, "ui-schema.json");
    const cases = {
      slug: "cases",
      fields: [{ name: "rating", type: "number" }],
    };
    writeFileSync(
      definitions,
      JSON.stringify({
        collections: [
          cases,
          { slug: "docs", fields: [{ name: "pages", type: "number" }] },
        ],
        singles: [],
        components: [],
      })
    );
    exported.config = { db: { migrationsDir: "./migrations" } };
    const first = await run(["migrate:create", "--name", "both"]);
    expect(first.status, first.stderr).toBe(0);

    writeFileSync(
      definitions,
      JSON.stringify({ collections: [cases], singles: [], components: [] })
    );
    exported.config = {
      db: { migrationsDir: "./migrations" },
      plugins: [
        {
          name: "@acme/seo",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            extend: [
              { target: "cases", fields: [{ name: "rating", type: "number" }] },
            ],
          },
        },
      ],
    };

    const ran = await run(["generate:types"]);

    expect(ran.status, ran.stderr).toBe(1);
    expect(ran.stderr).not.toContain("BUILDER_DEFINITION_MISSING");
    expect(ran.stderr).toContain("rating");
  }, 300_000);
});

describe("a configuration file deleted while the development server runs", () => {
  afterEach(async () => {
    await shutdownServices();
  });

  // A save that leaves no configuration file is not a configuration that declares nothing: the
  // reload keeps the one it has and says why, rather than planning to remove every table.
  it("is refused by the reload, with the report a command prints", async () => {
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

    expect(
      warned.some(message => message.includes("CONFIG_MISSING")),
      warned.join("\n---\n")
    ).toBe(true);
  }, 120_000);
});
