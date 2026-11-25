/**
 * A `nextly repair-columns` run that stops on what it reads names it without `--verbose`: the
 * registry row, the snapshot or the migration file, and what to do next. Under `--json` the
 * document's error carries the same code and parts. Either way the run ends with exit 1.
 *
 * The read is the real one, over a SQLite database and a migrations folder each case breaks in one
 * way; only the configuration and the connection are handed to the command.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adapter: undefined as unknown,
  projectRoot: "",
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: "sqlite",
    databaseUrl: "file:./unused.db",
  }),
  // The test's own database, which the command must not close: each case runs it twice.
  createCliAdapter: () =>
    Promise.resolve(
      new Proxy(state.adapter as object, {
        get(target, property) {
          if (property === "disconnect") return () => Promise.resolve();
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    ),
}));
vi.mock("../../utils/config-loader", () => ({
  loadConfig: () =>
    Promise.resolve({
      config: {
        collections: [],
        db: { migrationsDir: ".", uiSchemaFile: "ui-schema.json" },
      },
      projectRoot: state.projectRoot,
    }),
}));
vi.mock("../../utils/registry-resolver", () => ({
  installRegistryResolver: () => {},
}));

import {
  seedBuilderCollection,
  seedBuilderComponent,
} from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { createContext } from "../../context";
import { repairColumnsAction } from "../repair-columns";

describe("repair-columns names what stopped it, without --verbose", () => {
  let handle: TestNextly;
  let root: string;
  const adapter = () => handle.adapter as unknown as DrizzleAdapter;
  const run = (sql: string) => adapter().executeQuery(sql);

  beforeEach(async () => {
    handle = await createTestNextly({});
    state.adapter = handle.adapter;
    root = mkdtempSync(join(tmpdir(), "nextly-repair-columns-stop-"));
    state.projectRoot = root;
    mkdirSync(join(root, "meta"));
    vi.stubEnv("CI", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
    await handle?.destroy();
  });

  /** Run the command, and return what it wrote to each stream and the exit code it set. */
  async function command(json: boolean) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
        stdout.push(String(chunk));
        return true;
      }),
      vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
        stderr.push(String(chunk));
        return true;
      }),
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdout.push(args.join(" "));
      }),
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        stderr.push(args.join(" "));
      }),
    ];
    process.exitCode = undefined;
    try {
      await repairColumnsAction(createContext)({ json }, {
        optsWithGlobals: () => ({ cwd: root }),
      } as unknown as Command);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    return {
      stdout: stdout.join("\n"),
      // Colours are the terminal's; the words are the contract.
      stderr: stripVTControlCharacters(stderr.join("\n")),
      exitCode: process.exitCode,
    };
  }

  /** Both outputs end with `code`, naming `named` and the next step, at exit 1. */
  async function expectStop(code: string, named: string[]) {
    const text = await command(false);
    expect(text.exitCode).toBe(1);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain(`(${code})`);
    for (const part of named) expect(text.stderr).toContain(part);
    expect(text.stderr).not.toContain("Server configuration error");
    expect(text.stderr).not.toContain("--verbose");

    const json = await command(true);
    expect(json.exitCode).toBe(1);
    const document = JSON.parse(json.stdout) as {
      schema: string;
      result: unknown;
      errors: Array<Record<string, string>>;
    };
    expect(document.schema).toBe("nextly.repair-columns/1");
    expect(document.result).toBeNull();
    expect(document.errors).toHaveLength(1);
    const [error] = document.errors;
    expect(Object.keys(error).sort()).toEqual([
      "cause",
      "code",
      "docs",
      "message",
      "next",
    ]);
    expect(error.code).toBe(code);
    const words = `${error.message} ${error.cause} ${error.next}`;
    for (const part of named) expect(words).toContain(part);
  }

  /** Write a snapshot with its migration file, and record the migration as applied. */
  async function applied(name: string, content: string) {
    writeFileSync(join(root, "meta", `${name}.snapshot.json`), content);
    writeFileSync(join(root, `${name}.sql`), "");
    if (!(await adapter().tableExists("nextly_schema_events"))) {
      for (const statement of getSchemaEventsDdl("sqlite")) {
        await run(statement);
      }
    }
    const events = new SchemaEventsRepository(adapter().getDrizzle(), "sqlite");
    const filename = `${name}.sql`;
    const id = await events.recordStart({
      eventType: "file_apply",
      source: "cli-migrate",
      filename,
    });
    await events.markApplied(id, { uniqueFilename: filename });
  }

  it("a registry row that names no table", async () => {
    await seedBuilderCollection(adapter(), {
      slug: "rsposts",
      fields: [{ name: "price", type: "number" }],
    });
    await run(
      `UPDATE "dynamic_collections" SET "table_name" = '' WHERE "slug" = 'rsposts'`
    );
    await expectStop("REGISTRY_ROW_WITHOUT_TABLE", [
      'the collection "rsposts"',
      "`dynamic_collections`",
      "Set the row's `table_name`",
    ]);
  });

  it("a registry row marked as diverged", async () => {
    await seedBuilderComponent(adapter(), {
      slug: "rscard",
      fields: [{ name: "label", type: "text" }],
    });
    for (const table of ["dynamic_components", "dynamic_field_groups"]) {
      if (!(await adapter().tableExists(table))) continue;
      await run(
        `UPDATE "${table}" SET "migration_status" = 'diverged' WHERE "slug" = 'rscard'`
      );
    }
    await expectStop("REGISTRY_ROW_DIVERGED", [
      'the field group "rscard"',
      'choose "Repair definition" on "rscard"',
    ]);
  });

  it("an applied snapshot that cannot be parsed", async () => {
    await applied("0001_broken", "{ not json");
    await expectStop("INVALID_SNAPSHOT", [
      "`meta/0001_broken.snapshot.json`",
      "JSON parse failed",
      "Restore it from version control",
    ]);
  });

  it("an applied snapshot whose migration file is gone", async () => {
    await applied("0001_lost", "{}");
    rmSync(join(root, "0001_lost.sql"));
    await expectStop("MISSING_MIGRATION", [
      "no migration file of `0001_lost` does",
      "Restore the migration's .sql file from version control",
    ]);
  });
});
