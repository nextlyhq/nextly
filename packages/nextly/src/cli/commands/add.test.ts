/**
 * `nextly plugins add` (and `nextly add`) end to end in a project folder: the
 * install, the registration in nextly.config.ts, the build step, the types and
 * the schema, in that order; each refusal, and what it leaves untouched; the
 * options a plugin asks for; and `--dry-run`, which names every change and
 * makes none. The package manager, the type generation and the schema install
 * are stood in for here: what they record is what the command asked of them.
 * The real ones, in projects made from the templates, are
 * `plugins-add.integration.test.ts`'s.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { createContext } from "../context";
import { dryRunLines } from "../dry-run";

import { buildInstallArgs, runAdd, type AddCommandOptions } from "./add";

// The code the package manager ends with, and every step the command took.
const install = vi.hoisted(() => ({
  code: 0 as number | null,
  runs: [] as string[][],
  steps: [] as string[],
  notMigrated: false,
  // Whether someone is at the terminal, and what each prompt asked.
  terminal: false,
  asked: [] as string[],
  // The folder the run's environment files were read from, if any.
  environment: undefined as string | undefined,
  // The plugins the site's config registers when it is loaded, by name.
  configured: [] as string[],
  // Whether loading a config that lists a plugin fails, as one whose plugin
  // the loader refuses does.
  refuses: false,
}));

vi.mock("../utils/config-loader", async () => ({
  ...(await vi.importActual<typeof import("../utils/config-loader")>(
    "../utils/config-loader"
  )),
  loadConfig: async ({ cwd }: { cwd: string }) => {
    const { readFile: read } = await import("node:fs/promises");
    const { join: joined } = await import("node:path");
    const text = await read(joined(cwd, "nextly.config.ts"), "utf8");
    if (install.refuses && text.includes("plugins: [")) {
      // As the loader refuses a plugin, through a NextlyError.
      const { NextlyError: Refusal } = await import(
        "../../errors/nextly-error"
      );
      throw Refusal.conflict({
        reason: "state",
        message: 'The plugin "@acme/p" needs nextly >=99.0.0.',
      });
    }
    return {
      config: { plugins: install.configured.map(name => ({ name })) },
    };
  },
}));

vi.mock("../environment", async () => ({
  ...(await vi.importActual<typeof import("../environment")>("../environment")),
  environmentFolder: () => install.environment,
}));

vi.mock("../../domains/schema/migrate/can-prompt", async () => ({
  ...(await vi.importActual<
    typeof import("../../domains/schema/migrate/can-prompt")
  >("../../domains/schema/migrate/can-prompt")),
  canPrompt: () => install.terminal,
}));

vi.mock("@clack/prompts", async () => ({
  ...(await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts")),
  text: async ({ message }: { message: string }) => {
    install.asked.push(message);
    return "https://asked.example";
  },
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: (command: string, args: string[]) => {
      install.runs.push([command, ...args]);
      install.steps.push(`install ${args.at(-1)}`);
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", install.code));
      return child;
    },
  };
});

vi.mock("./generate-types", () => ({
  runGenerateTypes: async () => {
    install.steps.push("generate:types");
  },
}));

vi.mock("./plugin-lifecycle-runner", async () => {
  const actual = await vi.importActual<
    typeof import("./plugin-lifecycle-runner")
  >("./plugin-lifecycle-runner");
  return {
    isDatabaseNotMigrated: actual.isDatabaseNotMigrated,
    runPluginInstall: async (name: string) => {
      install.steps.push(`plugins install ${name}`);
      if (install.notMigrated) {
        throw NextlyError.conflict({
          reason: "state",
          message: "This database has not been migrated yet.",
          logContext: { reason: "database-not-migrated" },
        });
      }
    },
  };
});

// `../program` imports every command; `add` needs only its context factory.
vi.mock("../program", async () => ({
  createContext: (await import("../context")).createContext,
}));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

describe("buildInstallArgs", () => {
  it("uses `add` for pnpm/yarn and `install` for npm", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("yarn", "@acme/p", false)).toEqual([
      "add",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", false)).toEqual([
      "install",
      "@acme/p",
    ]);
  });

  it("inserts the dev flag before the package", () => {
    expect(buildInstallArgs("pnpm", "@acme/p", true)).toEqual([
      "add",
      "-D",
      "@acme/p",
    ]);
    expect(buildInstallArgs("npm", "@acme/p", true)).toEqual([
      "install",
      "-D",
      "@acme/p",
    ]);
  });
});

const CONFIG = `import { defineConfig } from "nextly/config";

export default defineConfig({
  collections: [],
});
`;

const MANIFEST = `${JSON.stringify(
  {
    name: "site",
    private: true,
    scripts: { build: "nextly migrate && next build" },
  },
  null,
  2
)}\n`;

/** A plugin package that declares nothing and exports its definition. */
const PLAIN = {
  manifest: { name: "@acme/p", type: "module", exports: "./index.js" },
  entry: `export const acmePlugin = { name: "@acme/p", version: "1.0.0", nextly: "*" };\n`,
};

/** A plugin package that declares a function asking for the site's address. */
const ASKING = {
  manifest: {
    name: "@acme/p",
    type: "module",
    exports: "./index.js",
    nextly: {
      plugin: {
        export: "acme",
        call: true,
        options: {
          siteUrl: {
            description: "The site's production address",
            format: "url",
          },
        },
      },
    },
  },
  entry: `export function acme(options) {
  if (!options || !options.siteUrl) throw new Error("siteUrl is required");
  return { name: "@acme/p", version: "1.0.0", nextly: "*" };
}
`,
};

describe("nextly plugins add", () => {
  let project: string;
  let output: string[];

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "nextly-plugins-add-"));
    // The lockfile picks the package manager.
    await writeFile(join(project, "pnpm-lock.yaml"), "");
    await writeFile(join(project, "package.json"), MANIFEST);
    await writeFile(join(project, "nextly.config.ts"), CONFIG);
    install.code = 0;
    install.runs = [];
    install.steps = [];
    install.notMigrated = false;
    install.terminal = false;
    install.asked = [];
    install.environment = undefined;
    install.configured = [];
    install.refuses = false;
    output = [];
    const record = (...parts: unknown[]) => {
      output.push(parts.map(String).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Exited(code === undefined ? undefined : Number(code));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  });

  /** Puts a plugin package in the project's node_modules, as an install would. */
  async function installed(plugin: { manifest: object; entry: string }) {
    const dir = join(project, "node_modules", "@acme", "p");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(plugin.manifest));
    await writeFile(join(dir, "index.js"), plugin.entry);
  }

  /** Runs the command, returning the exit code it ended with, if it exited. */
  async function add(
    options: AddCommandOptions = {}
  ): Promise<number | undefined> {
    try {
      await runAdd(
        "@acme/p",
        { cwd: project, ...options },
        createContext({ noColor: true })
      );
      return undefined;
    } catch (error) {
      if (error instanceof Exited) return error.code;
      // An error the action reports, as `addAction` would.
      if (error instanceof NextlyError) {
        output.push(`(${error.code})`);
        return 1;
      }
      throw error;
    }
  }

  const config = () => readFile(join(project, "nextly.config.ts"), "utf8");
  const build = async () =>
    (
      JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        scripts: { build: string };
      }
    ).scripts.build;
  /** What the logger printed as info, without its symbol. */
  const info = () =>
    output.filter(line => line.startsWith("ℹ ")).map(line => line.slice(2));

  it("installs, registers, adds the build step, generates types and applies the schema, in that order", async () => {
    await installed(PLAIN);
    expect(await add()).toBeUndefined();

    expect(install.runs).toEqual([["pnpm", "add", "@acme/p"]]);
    expect(install.steps).toEqual([
      "install @acme/p",
      "generate:types",
      "plugins install @acme/p",
    ]);
    expect(await config()).toContain(`import { acmePlugin } from "@acme/p";`);
    expect(await config()).toContain(`plugins: [acmePlugin],`);
    expect(await build()).toBe(
      "nextly migrate && nextly plugins install @acme/p && next build"
    );
  });

  it("run again, changes no file, and installs the schema again", async () => {
    await installed(PLAIN);
    await add();
    const manifest = () => readFile(join(project, "package.json"), "utf8");
    const [before, scripts] = [await config(), await manifest()];
    install.steps = [];

    expect(await add({ skipInstall: true })).toBeUndefined();
    expect(await config()).toBe(before);
    expect(await manifest()).toBe(scripts);
    expect(install.steps).toEqual([
      "generate:types",
      "plugins install @acme/p",
    ]);
  });

  it("exits 1 whatever code the package manager ended with, naming it, and changes nothing", async () => {
    install.code = 254;
    expect(await add()).toBe(1);
    const printed = output.join("\n");
    expect(printed).toMatch(/pnpm exited [^\n]*254/);
    expect(printed).toContain("(PACKAGE_INSTALL_FAILED)");
    expect(await config()).toBe(CONFIG);
  });

  it("exits 1 when the package manager was stopped without a code", async () => {
    install.code = null;
    expect(await add()).toBe(1);
  });

  it("installs a first-party package at the version of the nextly the site has", async () => {
    const nextly = join(project, "node_modules", "nextly");
    await mkdir(nextly, { recursive: true });
    await writeFile(
      join(nextly, "package.json"),
      JSON.stringify({ name: "nextly", version: "0.0.2-alpha.80" })
    );
    const add = (spec: string) =>
      runAdd(
        spec,
        { cwd: project, dryRun: true },
        createContext({ noColor: true })
      );
    await add("@nextlyhq/plugin-form-builder");
    await add("@nextlyhq/plugin-form-builder@0.0.2-alpha.79");
    await add("@acme/p");
    expect(info().filter(line => line.startsWith("Would run"))).toEqual([
      "Would run pnpm add @nextlyhq/plugin-form-builder@0.0.2-alpha.80",
      "Would run pnpm add @nextlyhq/plugin-form-builder@0.0.2-alpha.79",
      "Would run pnpm add @acme/p",
    ]);
  });

  it("refuses a package that is not installed, with --skip-install", async () => {
    expect(await add({ skipInstall: true })).toBe(1);
    expect(output.join("\n")).toContain("(PLUGIN_PACKAGE_NOT_INSTALLED)");
    expect(install.steps).toEqual([]);
  });

  describe("a plugin that asks for the site's address", () => {
    it("is refused without it where no one can be asked, and the config is left as it was", async () => {
      await installed(ASKING);
      expect(await add({ skipInstall: true })).toBe(1);
      expect(output.join("\n")).toContain("(PLUGIN_OPTION_MISSING)");
      expect(await config()).toBe(CONFIG);
      expect(await build()).toBe("nextly migrate && next build");
      expect(install.steps).toEqual([]);
    });

    it("is registered with it, called with the address", async () => {
      await installed(ASKING);
      expect(
        await add({
          skipInstall: true,
          option: ["siteUrl=https://example.com"],
        })
      ).toBeUndefined();
      expect(await config()).toContain(
        `plugins: [acme({ siteUrl: "https://example.com" })],`
      );
      expect(install.steps).toEqual([
        "generate:types",
        "plugins install @acme/p",
      ]);
    });

    it("is asked for at the terminal when not given", async () => {
      await installed(ASKING);
      install.terminal = true;
      expect(await add({ skipInstall: true })).toBeUndefined();
      expect(install.asked).toEqual([
        "The site's production address (siteUrl)",
      ]);
      expect(await config()).toContain(
        `plugins: [acme({ siteUrl: "https://asked.example" })],`
      );
    });

    it("refuses an address that is not one, and changes nothing", async () => {
      await installed(ASKING);
      expect(
        await add({ skipInstall: true, option: ["siteUrl=example.com"] })
      ).toBe(1);
      expect(output.join("\n")).toContain("(PLUGIN_OPTION_INVALID)");
      expect(await config()).toBe(CONFIG);
    });
  });

  it("leaves the schema to the build on a database not migrated yet, and succeeds", async () => {
    await installed(PLAIN);
    install.notMigrated = true;
    expect(await add({ skipInstall: true })).toBeUndefined();
    expect(output.join("\n")).toMatch(/has not been migrated yet/);
    expect(await build()).toContain("nextly plugins install @acme/p");
  });

  it("applies the schema only with the environment of the project it adds to", async () => {
    await installed(PLAIN);
    install.environment = join(project, "elsewhere");
    expect(await add({ skipInstall: true })).toBeUndefined();
    expect(install.steps).toEqual(["generate:types"]);
    expect(output.join("\n")).toMatch(/environment files were read from/);

    install.environment = project;
    install.steps = [];
    expect(await add({ skipInstall: true })).toBeUndefined();
    expect(install.steps).toEqual([
      "generate:types",
      "plugins install @acme/p",
    ]);
  });

  it("leaves a config that registers the plugin some other way as it is", async () => {
    await installed(PLAIN);
    const factory = `import { defineConfig } from "nextly/config";
import { acme } from "@acme/p";

const made = acme();

export default defineConfig({ plugins: [made.plugin] });
`;
    await writeFile(join(project, "nextly.config.ts"), factory);
    install.configured = ["@acme/p"];
    expect(await add({ skipInstall: true })).toBeUndefined();
    expect(await config()).toBe(factory);
    expect(output.join("\n")).toMatch(/already registers @acme\/p/);
  });

  it("puts the config back when the loader refuses it with the plugin, and stops", async () => {
    await installed(PLAIN);
    install.refuses = true;
    expect(await add({ skipInstall: true })).toBe(1);
    expect(await config()).toBe(CONFIG);
    expect(await build()).toBe("nextly migrate && next build");
    expect(install.steps).toEqual([]);
    expect(output.join("\n")).toMatch(/was put back as it was/);
  });

  describe("--dry-run", () => {
    it("names every change in order, and makes none", async () => {
      await installed(PLAIN);
      expect(await add({ dryRun: true })).toBeUndefined();

      expect(install.runs).toEqual([]);
      expect(install.steps).toEqual([]);
      expect(await config()).toBe(CONFIG);
      expect(await build()).toBe("nextly migrate && next build");
      expect(info().slice(-6)).toEqual(
        dryRunLines({
          changes: [
            { action: "run", target: "pnpm add @acme/p" },
            { action: "edit", target: "nextly.config.ts" },
            { action: "edit", target: "package.json" },
            { action: "run", target: "nextly generate:types" },
            { action: "run", target: "nextly plugins install @acme/p" },
          ],
        })
      );
    });

    it("names the install, and says the rest follows it, for a package not installed yet", async () => {
      expect(await add({ dev: true, dryRun: true })).toBeUndefined();
      expect(install.runs).toEqual([]);
      expect(info().at(-3)).toBe("Would run pnpm add -D @acme/p");
      expect(info().at(-2)).toMatch(/once it is installed/);
    });

    it("reports a config it cannot edit as the real run's refusal, and exits 0", async () => {
      await installed(PLAIN);
      const held = `import { defineConfig } from "nextly/config";
const plugins = [];
export default defineConfig({ plugins });
`;
      await writeFile(join(project, "nextly.config.ts"), held);
      expect(await add({ skipInstall: true, dryRun: true })).toBeUndefined();
      expect(info().join("\n")).toMatch(
        /A real run would refuse: The plugin was not added to your configuration/
      );
      expect(await config()).toBe(held);
    });

    it("reports the refusal the real run would meet, asking nothing", async () => {
      await installed(ASKING);
      install.terminal = true;
      expect(await add({ skipInstall: true, dryRun: true })).toBeUndefined();
      expect(install.asked).toEqual([]);
      expect(info().join("\n")).toMatch(
        /A real run would refuse: "@acme\/p" needs siteUrl/
      );
      expect(await config()).toBe(CONFIG);
    });
  });
});
