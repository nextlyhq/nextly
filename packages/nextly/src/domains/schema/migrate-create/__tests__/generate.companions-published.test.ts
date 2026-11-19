/**
 * A migration's companion files are published in the same step as the
 * migration itself, before the writer's last look at its hold: a writer that
 * has lost the project's migration files to another by the time its
 * companions are written stops and says so, rather than ending as a run that
 * wrote its migration and adding steps after its successor's unnoticed.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateMigration, type MinimalConfigEntity } from "../generate";
import {
  WRITER_LOCK_FILE,
  isWriterHoldLost,
  setWriterHoldBounds,
  withMigrationWriterHold,
} from "../writer-hold";

/** A step taken as the first companion file is written, once. */
const between = vi.hoisted(() => ({
  beforeCompanion: undefined as (() => void) | undefined,
}));

vi.mock(
  "../../../i18n/migration/write-migration-file",
  async importOriginal => {
    const real =
      await importOriginal<
        typeof import("../../../i18n/migration/write-migration-file")
      >();
    return {
      ...real,
      writeCompanionMigrationFile: (
        ...args: Parameters<typeof real.writeCompanionMigrationFile>
      ) => {
        const step = between.beforeCompanion;
        between.beforeCompanion = undefined;
        step?.();
        return real.writeCompanionMigrationFile(...args);
      },
    };
  }
);

let migrationsDir: string;
let restore: () => void;

beforeEach(() => {
  migrationsDir = mkdtempSync(join(tmpdir(), "nextly-companions-published-"));
  restore = setWriterHoldBounds({
    waitMs: 0,
    leaseSeconds: 30,
    renewMs: 600_000,
  });
});

afterEach(() => {
  restore();
  between.beforeCompanion = undefined;
  rmSync(migrationsDir, { recursive: true, force: true });
});

/** A translated collection, whose migration comes with a companion file. */
const docs: MinimalConfigEntity = {
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [
    { name: "body", type: "longText", localized: true },
    { name: "price", type: "number" },
  ],
};

const generate = () =>
  withMigrationWriterHold({ migrationsDir, command: "migrate:create" }, () =>
    generateMigration({
      name: "create_docs",
      dialect: "sqlite",
      migrationsDir,
      defaultLocale: "en",
      collections: [docs],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date("2026-07-09T12:00:00.000Z"),
    })
  );

const migrationFiles = () =>
  readdirSync(migrationsDir).filter(name => name.endsWith(".sql"));

describe("a migration's companion files", () => {
  it("are written with it (the control: a run that keeps the folder writes both)", async () => {
    const result = await generate();

    expect(result).not.toBeNull();
    expect(migrationFiles().length).toBeGreaterThanOrEqual(2);
  });

  it("are written before the run's last look at its hold, so a run overtaken by then says so", async () => {
    const lock = join(migrationsDir, WRITER_LOCK_FILE);
    // As another writer leaves the folder once it has set this run's lapsed
    // hold aside and taken it: its own record at the hold's path.
    between.beforeCompanion = () => {
      const mine = JSON.parse(readFileSync(lock, "utf-8")) as Record<
        string,
        unknown
      >;
      renameSync(lock, `${lock}.set-aside`);
      rmSync(`${lock}.set-aside`);
      writeFileSync(
        lock,
        JSON.stringify({
          ...mine,
          token: "another-writer",
          command: "migrate:baseline",
        })
      );
    };

    let lost: unknown;
    try {
      await generate();
    } catch (error) {
      lost = error;
    }

    // The run does not end as one that wrote its migration: it stops as a
    // writer another overtook, naming the file it wrote.
    expect(isWriterHoldLost(lost)).toBe(true);
    expect((lost as { publicMessage: string }).publicMessage).toMatch(
      /as it wrote \S*create_docs\.sql/
    );
    // What it wrote is left, companions included: a writer removes no
    // migration file once it is in the folder.
    expect(migrationFiles().length).toBeGreaterThanOrEqual(2);
    // And the other writer's hold is untouched.
    expect(existsSync(lock)).toBe(true);
    expect(
      (JSON.parse(readFileSync(lock, "utf-8")) as { command: string }).command
    ).toBe("migrate:baseline");
  });
});
