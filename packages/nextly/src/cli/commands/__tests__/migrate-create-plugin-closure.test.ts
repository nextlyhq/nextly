/**
 * `migrate:create --plugin` compiles the target beside its WHOLE dependency
 * closure, in dependency order.
 *
 * With C depending on B and B's hook extending a table of B's own dependency
 * A, compiling C runs B's hook. That hook needs A's table in the draft and B's
 * dependency edge on A; given only C's direct dependencies it fails on
 * `Table "a__orders" does not exist` although boot, which compiles every
 * plugin, resolves the same graph.
 *
 * The bundler is stubbed because it compiles files to disk and imports them,
 * which needs a real project tree. Everything under test runs after that
 * step: the config's plugin resolution, the closure, the per-dialect drafts
 * and the module the generator writes.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { createContext } from "../../program";
import { clearConfigCache } from "../../utils/config-loader";
import { pluginDependencyClosure, runMigrateCreate } from "../migrate-create";

const bundleAndRequire = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-bundler", () => ({ bundleAndRequire }));

/** A plugin fixture: `nextly`/`version` satisfy the config's resolver. */
function plugin(
  name: string,
  extra: Omit<Partial<PluginDefinition>, "name"> = {}
): PluginDefinition {
  return { name, version: "1.0.0", nextly: ">=0.0.0", ...extra };
}

/** A hook putting one nullable column on another plugin's table. */
function addsColumnTo(table: string, column: string) {
  return ({
    schema,
  }: {
    schema: { extendTable(name: string, ext: unknown): void };
  }) => {
    schema.extendTable(table, {
      columns: { [column]: col.shortText({ nullable: true }) },
    });
  };
}

const A = plugin("@t/a", {
  contributes: {
    schema: { prefix: "a", tables: [defineTable("orders", { id: col.id() })] },
  },
});

/** B owns a table and puts a column on its own dependency A's table. */
const B = plugin("@t/b", {
  dependsOn: { "@t/a": ">=1.0.0" },
  contributes: {
    schema: {
      prefix: "b",
      tables: [defineTable("links", { id: col.id() })],
      extend: [addsColumnTo("a__orders", "bRef")],
    },
  },
});

/** C depends only on B, and declares one table of its own. */
const C = plugin("@t/c", {
  schemaVersion: 1,
  dependsOn: { "@t/b": ">=1.0.0" },
  contributes: {
    schema: { prefix: "c", tables: [defineTable("notes", { id: col.id() })] },
  },
});

function reasonOf(error: unknown): unknown {
  return error instanceof NextlyError
    ? (error.logContext as { reason?: unknown } | undefined)?.reason
    : undefined;
}

describe("pluginDependencyClosure", () => {
  it("walks the transitive closure and orders dependencies first", () => {
    const closure = pluginDependencyClosure(C, [C, B, A]);

    expect(closure.dependencyPlugins.map(p => p.name)).toEqual([
      "@t/a",
      "@t/b",
    ]);
    // Every member's edges, not just the target's: B's hook is judged by
    // B's own dependency set when it adds a column to A's table.
    expect(closure.dependencies.get("@t/b")).toEqual(new Set(["@t/a"]));
    expect(closure.dependencies.get("@t/c")).toEqual(new Set(["@t/b"]));
    expect(closure.dependencies.get("@t/a")).toEqual(new Set());
    expect([...closure.pluginPrefixes]).toEqual([
      ["@t/a", "a"],
      ["@t/b", "b"],
      ["@t/c", "c"],
    ]);
  });

  it("leaves out configured plugins outside the closure", () => {
    const unrelated = plugin("@t/unrelated");
    const closure = pluginDependencyClosure(C, [unrelated, A, B]);

    expect(closure.dependencyPlugins.map(p => p.name)).toEqual([
      "@t/a",
      "@t/b",
    ]);
    expect(closure.pluginPrefixes.has("@t/unrelated")).toBe(false);
  });

  it("follows a configured optional dependency and skips an absent one", () => {
    const target = plugin("@t/opt", {
      optionalDependsOn: { "@t/b": ">=1.0.0", "@t/absent": ">=1.0.0" },
    });
    const closure = pluginDependencyClosure(target, [A, B]);

    expect(closure.dependencyPlugins.map(p => p.name)).toEqual([
      "@t/a",
      "@t/b",
    ]);
  });

  it("uses the target entry over a configured plugin of the same name", () => {
    const configuredC = plugin("@t/c", { dependsOn: {} });
    const closure = pluginDependencyClosure(C, [A, B, configuredC]);

    expect(closure.dependencies.get("@t/c")).toEqual(new Set(["@t/b"]));
  });

  it("refuses a missing required dependency deeper in the chain as boot does", () => {
    const error = (() => {
      try {
        pluginDependencyClosure(C, [B]);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(error).toBeInstanceOf(NextlyError);
    expect((error as NextlyError).code).toBe("PLUGIN_RESOLUTION_ERROR");
    expect(reasonOf(error)).toBe("missing-dependency");
  });

  it("refuses a cycle through the target as boot does", () => {
    const loopsBack = plugin("@t/b", { dependsOn: { "@t/c": ">=1.0.0" } });
    const error = (() => {
      try {
        pluginDependencyClosure(C, [loopsBack]);
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();

    expect(reasonOf(error)).toBe("dependency-cycle");
  });
});

describe("migrate:create --plugin over a dependency chain", () => {
  let dir: string;
  let entry: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-plugin-closure-"));
    entry = join(dir, "src", "index.ts");
    configPath = join(dir, "nextly.config.ts");
    // The loader stats the config path before bundling it.
    await writeFile(configPath, "");
    clearConfigCache();
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`process.exit(${String(code)})`);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    bundleAndRequire.mockReset();
    clearConfigCache();
    await rm(dir, { recursive: true, force: true });
  });

  /** Generate `target`'s module against a config carrying `configured`. */
  async function generate(
    target: PluginDefinition,
    configured: PluginDefinition[]
  ): Promise<string> {
    bundleAndRequire.mockImplementation(({ filepath }: { filepath: string }) =>
      Promise.resolve({
        mod: {
          default: filepath === entry ? target : { plugins: configured },
        },
        dependencies: [],
      })
    );
    await runMigrateCreate(
      "initial",
      { plugin: entry, config: configPath, cwd: dir },
      createContext({ quiet: true })
    );
    const migrationsDir = join(dir, "src", "migrations");
    const modules = (await readdir(migrationsDir)).filter(
      file => file !== "index.ts"
    );
    expect(modules).toHaveLength(1);
    return await readFile(join(migrationsDir, modules[0]), "utf8");
  }

  it("generates C's module with only C's changes", async () => {
    const source = await generate(C, [A, B]);

    expect(source).toMatch(/CREATE TABLE \W*c__notes/);
    // Neither dependency's table, nor B's column on A's table: those ship in
    // their owners' streams, not in C's module.
    expect(source).not.toContain("a__orders");
    expect(source).not.toContain("b__links");
    expect(source).not.toContain("b_ref");
  });

  it("still carries a column the target adds to a direct dependency's table", async () => {
    const direct = plugin("@t/direct", {
      schemaVersion: 1,
      dependsOn: { "@t/a": ">=1.0.0" },
      contributes: {
        schema: {
          prefix: "d",
          tables: [defineTable("notes", { id: col.id() })],
          extend: [addsColumnTo("a__orders", "dRef")],
        },
      },
    });
    const source = await generate(direct, [A]);

    expect(source).toMatch(/CREATE TABLE \W*d__notes/);
    // The column, never a CREATE of the table it lands on.
    expect(source).toMatch(/ALTER TABLE \W*a__orders\W* ADD COLUMN \W*d_ref/);
    expect(source).not.toMatch(/CREATE TABLE \W*a__orders/);
  });
});
