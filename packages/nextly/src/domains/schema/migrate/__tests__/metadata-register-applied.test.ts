/**
 * Registration only claims `applied` for migrations that actually ran.
 *
 * 🔴 `registerFromMigrations` inserts every entity it finds with
 * `migrationStatus: "applied"`, and it finds them by reading EVERY
 * `*.snapshot.json` in the directory. Under `nextly migrate --step N` that
 * includes snapshots for migrations the run never reached, so those entities
 * were exposed as applied while their tables may not exist — and the pending
 * sweep beside it cannot repair them, because a row asserted `applied` is not
 * pending any more. The claim outran the evidence in the one direction nothing
 * downstream can correct.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerFromMigrations } from "../metadata-register";

let dir: string;

/** A snapshot paired with the migration file whose name the ledger records. */
function snapshot(name: string, slug: string): void {
  writeFileSync(
    join(dir, "meta", `${name}.snapshot.json`),
    JSON.stringify({
      collections: [{ slug, label: slug, tableName: `dc_${slug}`, fields: [] }],
      singles: [],
    })
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-register-"));
  mkdirSync(join(dir, "meta"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * An adapter that reports every collection as missing, so registration always
 * wants to insert — the filtering under test is the only thing that can stop
 * it.
 */
function adapterStub() {
  const inserted: string[] = [];
  return {
    inserted,
    adapter: {
      getDrizzle: () => ({
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [] }) }),
        }),
        insert: () => ({
          values: async (row: { slug?: string }) => {
            if (row?.slug) inserted.push(row.slug);
          },
        }),
      }),
    } as never,
  };
}

describe("registerFromMigrations honours the applied ledger", () => {
  it("registers an entity whose migration has been applied", async () => {
    // The control. Without it, a filter that rejected EVERYTHING would satisfy
    // the exclusion below while registering nothing at all.
    snapshot("0001_init", "posts");
    const { adapter, inserted } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async () => true,
    });

    expect(inserted).toContain("posts");
  });

  it("skips an entity whose migration has NOT been applied", async () => {
    snapshot("0002_later", "drafts");
    const { adapter, inserted } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async () => false,
    });

    expect(inserted).not.toContain("drafts");
  });

  /*
   * The pairing is the part that can silently be wrong. The ledger records the
   * migration GROUP's `.sql` name — `runFileMigrations` writes `0001_x.sql`
   * whether it executed `0001_x.sql` or `0001_x.mysql.sql` — so a check built
   * from the snapshot's own filename has to strip `.snapshot.json` and add
   * `.sql`, not pass the snapshot name through.
   */
  it("asks the ledger for the migration's .sql name, not the snapshot's", async () => {
    snapshot("0003_pages", "pages");
    const { adapter } = adapterStub();
    const isApplied = vi.fn(async () => true);

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied,
    });

    expect(isApplied).toHaveBeenCalledWith("0003_pages.sql");
  });

  /*
   * Omitting the check keeps the previous behaviour, and that is deliberate
   * rather than an oversight: the dev boot path applies every pending
   * migration immediately before registering, so it has no unapplied snapshot
   * to skip and needs no ledger read to prove it.
   */
  it("registers everything when no ledger check is supplied", async () => {
    snapshot("0004_any", "notes");
    const { adapter, inserted } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
    });

    expect(inserted).toContain("notes");
  });
});
