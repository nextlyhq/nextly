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

/**
 * A snapshot paired with the migration file whose name the ledger records.
 *
 * `fields` is a parameter because the shape is what distinguishes one snapshot
 * of a slug from a later one: a test that cannot tell the two apart cannot see
 * which of them registration wrote.
 */
function snapshot(name: string, slug: string, fields: unknown[] = []): void {
  writeFileSync(
    join(dir, "meta", `${name}.snapshot.json`),
    JSON.stringify({
      collections: [{ slug, label: slug, tableName: `dc_${slug}`, fields }],
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
  const rows: { slug: string; fields: unknown[] }[] = [];
  return {
    inserted,
    rows,
    adapter: {
      getDrizzle: () => ({
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [] }) }),
        }),
        insert: () => ({
          values: async (row: { slug?: string; fields?: unknown[] }) => {
            if (row?.slug) {
              inserted.push(row.slug);
              rows.push({ slug: row.slug, fields: row.fields ?? [] });
            }
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
  /*
   * 🔴 The shape decides, not merely the presence of a row. A slug described by
   * an applied snapshot AND by a later pending one has an unsettled shape:
   * registration inserts once and returns early on every run after, so writing
   * the earlier shape now writes it for good — the later migration lands and
   * nothing revisits the row. Withheld until the newest snapshot naming it is
   * applied, which is the first run that can write the shape it will keep.
   */
  it("withholds a slug whose newest snapshot has not been applied", async () => {
    snapshot("0001_init", "posts", [{ name: "title" }]);
    snapshot("0002_add_body", "posts", [{ name: "title" }, { name: "body" }]);
    const { adapter, inserted } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async f => f === "0001_init.sql",
    });

    expect(inserted).not.toContain("posts");
  });

  it("registers that slug with the newer shape once its migration lands", async () => {
    // The other half. Without it, withholding forever would satisfy the case
    // above — and withholding forever is the "collection has no dashboard
    // cards" defect this whole path exists to remove.
    snapshot("0001_init", "posts", [{ name: "title" }]);
    snapshot("0002_add_body", "posts", [{ name: "title" }, { name: "body" }]);
    const { adapter, rows } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async () => true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.fields).toEqual([{ name: "title" }, { name: "body" }]);
  });

  it("registers a slug the pending snapshot does not name", async () => {
    // Withholding is per SLUG, not per run: an entity settled by the
    // migrations that did apply is unaffected by a pending one beside it.
    snapshot("0001_init", "posts", [{ name: "title" }]);
    snapshot("0002_drafts", "drafts", [{ name: "title" }]);
    const { adapter, inserted } = adapterStub();

    await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async f => f === "0001_init.sql",
    });

    expect(inserted).toContain("posts");
    expect(inserted).not.toContain("drafts");
  });

  /*
   * 🔴 A ledger that cannot be read is a database failure, not a malformed
   * snapshot file. Swallowed by the per-file guard it fails identically for
   * every snapshot, so the whole set is dropped and the caller is handed the
   * empty list that means "nothing to register" — announcing an up-to-date
   * database while none of the metadata was written. Left to throw, it reaches
   * the phase-level handler, which records the pass as unreadable.
   */
  it("propagates a ledger failure instead of reading it as a bad file", async () => {
    snapshot("0001_init", "posts");
    const { adapter, inserted } = adapterStub();

    await expect(
      registerFromMigrations({
        migrationsDir: dir,
        adapter,
        dialect: "sqlite",
        logger: { warn: () => {}, debug: () => {} },
        isApplied: async () => {
          throw new Error("ledger unreachable");
        },
      })
    ).rejects.toThrow("ledger unreachable");

    expect(inserted).toEqual([]);
  });

  it("still skips a malformed snapshot file without failing the pass", async () => {
    // The control for the case above: the per-file guard is still there, and
    // still does its own job. Without this, moving the ledger read out of it
    // could have removed the guard entirely and nothing would say so.
    writeFileSync(join(dir, "meta", "0001_broken.snapshot.json"), "{ not json");
    snapshot("0002_ok", "notes");
    const { adapter, inserted } = adapterStub();

    const result = await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async () => true,
    });

    expect(inserted).toContain("notes");
    expect(result.collectionsRegistered).toBe(1);
  });
});

/*
 * The two behaviours registration performs identically for both kinds. They
 * share one implementation, so they are asserted for both kinds: a helper that
 * quietly stopped applying to singles would otherwise look exactly like one
 * that still did.
 */
describe("registration skips a reserved name and survives a failed row", () => {
  /** An adapter whose inserts can be made to fail for a chosen slug. */
  function failingOn(badSlug: string | null) {
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
              if (row?.slug === badSlug) throw new Error("row is locked");
              if (row?.slug) inserted.push(row.slug);
            },
          }),
        }),
      } as never,
    };
  }

  it("skips a slug reserved by Nextly, for collections AND singles", async () => {
    // "users" is a system resource; registering it would recreate the
    // permission collision the create and rename paths refuse.
    writeFileSync(
      join(dir, "meta", "0001_reserved.snapshot.json"),
      JSON.stringify({
        collections: [{ slug: "users", tableName: "dc_users", fields: [] }],
        singles: [{ slug: "settings", tableName: "ds_settings", fields: [] }],
      })
    );
    const warnings: string[] = [];
    const { adapter, inserted } = failingOn(null);

    const result = await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: (m: string) => warnings.push(m), debug: () => {} },
      isApplied: async () => true,
    });

    expect(inserted).toEqual([]);
    expect(result.collectionsRegistered).toBe(0);
    expect(result.singlesRegistered).toBe(0);
    // Warned rather than silent, and named, so an operator can rename it.
    expect(warnings.join("\n")).toContain("users");
    expect(warnings.join("\n")).toContain("settings");
  });

  it("keeps registering after one entity fails to insert", async () => {
    writeFileSync(
      join(dir, "meta", "0001_two.snapshot.json"),
      JSON.stringify({
        collections: [
          { slug: "alpha", tableName: "dc_alpha", fields: [] },
          { slug: "beta", tableName: "dc_beta", fields: [] },
        ],
        singles: [],
      })
    );
    const { adapter, inserted } = failingOn("alpha");

    const result = await registerFromMigrations({
      migrationsDir: dir,
      adapter,
      dialect: "sqlite",
      logger: { warn: () => {}, debug: () => {} },
      isApplied: async () => true,
    });

    // One failure costs ONE entity its row, not the rest of the pass.
    expect(inserted).toEqual(["beta"]);
    expect(result.collectionsRegistered).toBe(1);
  });
});
