/**
 * `migrate:field-groups --apply` killed part-way is finished by the next run, from what the live
 * database holds: the next preview says a run stopped and where, and the next `--apply` finishes
 * it, every group readable under the current names with its content.
 *
 * The run is a process of its own (`helpers/migration-stop-child.ts`) that kills itself at a named
 * stop point (`NEXTLY_TEST_KILL_AT`): during the content rewrite, after one batch has committed and
 * before its progress is recorded, and, on MySQL, where each rename commits on its own, between two
 * renames. A kill is what an operator's run meets when its process or host dies, and it leaves no
 * chance to record anything on the way out. A dropped connection is the other way a run stops: the
 * same process, whose sessions are ended from one of those points on.
 *
 * What separates a correct resume from a plausibly broken one:
 * - a resume that trusted the recorded step alone would skip the batch the kill interrupted, or
 *   rename again what the database already holds under its new name; here every row ends as one
 *   complete rewrite would leave it (the ledger check the run's own settlement makes), and each
 *   group has exactly the rows it had;
 * - a preview that read only a settled marker would report a stopped run as "not running", and one
 *   that read only the marker would call a run stopped while its claim may still be a live run's.
 *
 * @module domains/field-groups/migration/__tests__/storage-migration-resumes.integration.test
 */
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { recordStatements } from "../../../../__tests__/helpers/record-statements";
import { createAdapter } from "../../../../database/factory";
import { KILL_AT_VARIABLE } from "../../../schema/migrate/stop-points";
import { startScript } from "../../../schema/pipeline/__tests__/helpers/schema-lock-world";
import { getConfiguredTestDialects } from "../../../../plugins/test-nextly";
import { perLanguageStorageEnabled } from "../../../i18n/per-language-storage";
import { MetaService } from "../../../meta/services/meta-service";
import { MIGRATION_TARGET } from "../manifest";
import {
  FIELD_GROUP_STORAGE_VOCABULARY,
  LEGACY_STORAGE_VOCABULARY,
  assertLedgersSettled,
} from "../data-steps";
import { withMigrationSession, type MigrationDialect } from "../session";
import {
  RENAME_STEP_COMMITTED,
  REWRITE_BATCH_COMMITTED,
} from "../stop-point-names";

import {
  LIVE_COLLECTION,
  LIVE_DECLARED,
  LIVE_GROUP,
  LIVE_LOCALIZATION,
} from "../../__tests__/helpers/live-site-entities";
import {
  legacyObjects,
  openStorageGenerationSite,
  type StorageGenerationSite,
} from "../../__tests__/helpers/storage-generation-site";

const RUN = join(__dirname, "helpers", "migration-stop-child.ts");

/** The lease the killed run takes, so the resume finds the lock lapsed in seconds. */
const LEASE_SECONDS = 3;

/**
 * Where a run is killed. The content rewrite's point is after a batch has committed and before its
 * cursor is written; the rename point is after one rename has committed and before the next.
 */
const STOP_POINTS = [
  { point: REWRITE_BATCH_COMMITTED, dialects: "all" },
  { point: RENAME_STEP_COMMITTED, dialects: "mysql" },
] as const;

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

type Dialect = "sqlite" | "postgresql" | "mysql";

/** Where a stored document is kept: what the migration's content rewrite rewrites. */
const DOCUMENTS = [
  { table: "nextly_versions", column: "snapshot" },
  { table: "nextly_events", column: "payload" },
] as const;

/** The database's sessions, by the server's own id, the asking one among them. */
async function sessionsOf(
  at: Pick<StorageGenerationSite, "adapter">,
  dialect: Dialect
): Promise<Set<number>> {
  const rows = await at.adapter.executeQuery<{ id: number | string }>(
    dialect === "postgresql"
      ? "SELECT pid AS id FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"
      : "SELECT ID AS id FROM information_schema.PROCESSLIST WHERE DB = DATABASE() AND ID <> CONNECTION_ID()"
  );
  const own = await at.adapter.executeQuery<{ id: number | string }>(
    dialect === "postgresql"
      ? "SELECT pg_backend_pid() AS id"
      : "SELECT CONNECTION_ID() AS id"
  );
  return new Set([...rows, ...own].map(row => Number(row.id)));
}

/** Every stored document, by ledger and row, as its parsed value. */
async function documentsOf(
  at: StorageGenerationSite,
  dialect: Dialect
): Promise<Map<string, unknown>> {
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const found = new Map<string, unknown>();
  for (const { table, column } of DOCUMENTS) {
    const rows = await at.adapter.executeQuery<Record<string, unknown>>(
      `SELECT ${quote("id")} AS id, ${quote(column)} AS document FROM ${quote(table)}`
    );
    for (const row of rows) {
      const value = row.document;
      found.set(
        `${table}:${String(row.id)}`,
        typeof value === "string" ? JSON.parse(value) : value
      );
    }
  }
  return found;
}

/** `document` as one complete rewrite leaves it: the wire key renamed wherever it stands. */
function rewritten(document: unknown): unknown {
  if (Array.isArray(document)) return document.map(rewritten);
  if (document === null || typeof document !== "object") return document;
  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [
      key === LEGACY_STORAGE_VOCABULARY.wireTypeKey
        ? FIELD_GROUP_STORAGE_VOCABULARY.wireTypeKey
        : key,
      rewritten(value),
    ])
  );
}

/** Each document that held the wire key anywhere before the run. */
const holdsWireKey = (document: unknown): boolean =>
  JSON.stringify(document).includes(LEGACY_STORAGE_VOCABULARY.wireTypeKey);

/**
 * Finishes the stopped run, holding it to the whole of what a resume promises: it creates nothing,
 * renames nothing that an earlier step already renamed, and leaves every document as one complete
 * rewrite of what stood before the first run, with none lost and none added.
 */
async function finishesOnce(
  at: StorageGenerationSite,
  dialect: Dialect,
  before: ReadonlyMap<string, unknown>
): Promise<void> {
  const standing = new Set(
    (await at.adapter.listTables()).map(name => name.toLowerCase())
  );
  const recorder = await recordStatements(at.adapter, dialect);
  let statements: string[];
  try {
    expect((await at.migrateStorage()).ran).toBe(true);
  } finally {
    statements = [...recorder.statements];
    recorder.uninstall();
  }
  const renames = statements.flatMap(text => {
    const named =
      /ALTER TABLE\s+["`]?([\w$-]+)["`]?\s+RENAME\s+TO\s+["`]?([\w$-]+)/i.exec(
        text
      ) ??
      /RENAME TABLE\s+["`]?([\w$-]+)["`]?\s+TO\s+["`]?([\w$-]+)/i.exec(text);
    return named === null
      ? []
      : [{ from: named[1]!.toLowerCase(), to: named[2]!.toLowerCase() }];
  });
  const from = renames.map(each => each.from);
  // The registry is renamed last, so whatever an earlier run had done there is one left to see.
  expect(from.length, "renames seen").toBeGreaterThan(0);
  expect(new Set(from).size, "each table renamed at most once").toBe(
    from.length
  );
  for (const each of renames) {
    expect(standing, `${each.from} stood before the run`).toContain(each.from);
    expect(standing, `${each.to} was not there already`).not.toContain(each.to);
  }
  expect(
    statements.filter(
      text =>
        /^\s*CREATE TABLE/i.test(text) &&
        /["`]?(fg_|comp_|dynamic_field_groups|dynamic_components)/i.test(text)
    ),
    "no field-group table or registry created"
  ).toEqual([]);

  const after = await documentsOf(at, dialect);
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [key, document] of before) {
    expect(after.get(key), key).toEqual(rewritten(document));
  }
}

const cases = getConfiguredTestDialects().flatMap(dialect =>
  STOP_POINTS.filter(
    stop => stop.dialects === "all" || stop.dialects === dialect
  ).map(stop => ({ dialect, point: stop.point }))
);

describe.each(cases)(
  "migrate:field-groups --apply killed at $point ($dialect)",
  ({ dialect, point }) => {
    it("is reported by the next preview and finished by the next --apply, every group readable under the current names", async () => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        legacy: true,
        sqliteFile: true,
        localization: LIVE_LOCALIZATION,
      });
      // Several entries, each saved twice, so the ledgers hold rows enough for more than one
      // batch of the content rewrite to commit before the kill.
      const first = await site.developmentStart(LIVE_DECLARED);
      const headings = new Map<string, string>();
      for (let n = 0; n < 6; n++) {
        const created = await first.nextly.create({
          collection: LIVE_COLLECTION as never,
          data: { title: `P${n}`, card: { heading: `first-${n}` } } as never,
        });
        const id = (created.item as { id: string }).id;
        await first.nextly.update({
          collection: LIVE_COLLECTION as never,
          id,
          data: { card: { heading: `kept-${n}` }, _overwrite: true } as never,
        });
        headings.set(id, `kept-${n}`);
      }

      const before = await documentsOf(site, dialect);
      // The control for what the finished run is held to: there is something to rewrite.
      expect([...before.values()].filter(holdsWireKey).length).toBeGreaterThan(
        1
      );

      // The run, killed at the point.
      vi.stubEnv(KILL_AT_VARIABLE, point);
      const run = startScript(RUN, [
        dialect,
        site.url!,
        perLanguageStorageEnabled() ? "on" : "off",
        String(LEASE_SECONDS),
      ]);
      // Killed at the point: it ended without saying so, and not as a finished run ends. A process
      // that kills itself reports SIGKILL, or exit code 1 on Windows, which has no signals.
      const exited = await run.exited;
      expect(
        run.lines().filter(line => line.startsWith("ended")),
        `exited ${String(exited)}`
      ).toEqual([]);
      expect(exited).not.toBe(0);
      vi.unstubAllEnvs();

      // While the killed run's claim is unexpired, a preview cannot tell it from a run still
      // going, so it says the lock is held and nothing about a stop.
      const early = await site.migrateStorage({ dryRun: true });
      expect(early).toMatchObject({ ran: false, lock: { kind: "held" } });
      expect(early).not.toHaveProperty("stopped");

      // Once the claim has lapsed, the next preview reports the stopped run.
      await new Promise(resolve =>
        setTimeout(resolve, (LEASE_SECONDS + 1) * 1000)
      );
      const preview = await site.migrateStorage({ dryRun: true });
      expect(preview).toMatchObject({
        ran: false,
        lock: { kind: "not-held" },
        stopped: { direction: "up", step: expect.any(Number) },
      });

      // The next --apply finishes from it, once.
      await finishesOnce(site, dialect, before);
      expect((await site.marker())?.status).toBe("settled");
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);

      // Every group reads under the current names with its content, from a fresh start.
      const fresh = await site.developmentStart(LIVE_DECLARED);
      for (const [id, heading] of headings) {
        const read = await fresh.nextly.findByID({
          collection: LIVE_COLLECTION as never,
          id,
        });
        const item = ((read as { item?: unknown }).item ?? read) as {
          card?: { heading?: unknown };
        };
        expect(item.card?.heading, id).toBe(heading);
      }
      // One row per entry's group: nothing created twice.
      const rows = await site.adapter.executeQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM ${MIGRATION_TARGET.tablePrefix}${LIVE_GROUP}`
      );
      expect(Number(rows[0]?.n)).toBe(headings.size);
      // Every ledger row as one complete rewrite would leave it.
      await withMigrationSession(
        {
          adapter: site.adapter as never,
          dialect: dialect as MigrationDialect,
          label: "resume-settlement-probe",
        },
        session =>
          assertLedgersSettled({
            session,
            meta: new MetaService(
              site!.adapter as never,
              {
                debug() {},
                info() {},
                warn() {},
                error() {},
              } as never
            ),
            migrationId: "resume-settlement-probe",
            from: LEGACY_STORAGE_VOCABULARY,
            to: FIELD_GROUP_STORAGE_VOCABULARY,
          })
      );
    }, 600_000);
  }
);

describe.each(getConfiguredTestDialects().filter(each => each !== "sqlite"))(
  "migrate:field-groups --apply whose connections drop (%s)",
  dialect => {
    // SQLite has no connection to drop: its database is a file in the process that runs.
    it("stops, is reported by the next preview and finished once by the next --apply", async () => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        legacy: true,
        localization: LIVE_LOCALIZATION,
      });
      const first = await site.developmentStart(LIVE_DECLARED);
      for (let n = 0; n < 6; n++) {
        await first.nextly.create({
          collection: LIVE_COLLECTION as never,
          data: {
            title: `P${n}`,
            card: { heading: `kept-${n}`, tagline: `kept-${n}` },
          } as never,
        });
      }
      const before = await documentsOf(site, dialect);

      // Another session, which ends the run's, again and again from the point on: a run that asks
      // for a fresh connection loses that one too.
      const admin = await createAdapter({
        type: dialect,
        url: site.url!,
        pool: { max: 1 },
      } as Parameters<typeof createAdapter>[0]);
      const adminIds = new Set(
        (
          await admin.executeQuery<{ id: number | string }>(
            dialect === "postgresql"
              ? "SELECT pg_backend_pid() AS id"
              : "SELECT CONNECTION_ID() AS id"
          )
        ).map(row => Number(row.id))
      );
      // This suite's own sessions are idle by now, and stay open: the run's alone are ended.
      const mine = await sessionsOf(site, dialect);
      const run = startScript(RUN, [
        dialect,
        site.url!,
        perLanguageStorageEnabled() ? "on" : "off",
        String(LEASE_SECONDS),
        "pause",
      ]);
      await run.printed("paused");
      let exited = false;
      let ended = 0;
      const dropping = (async () => {
        while (!exited) {
          for (const id of await sessionsOf(
            { adapter: admin as never },
            dialect
          )) {
            if (mine.has(id) || adminIds.has(id)) continue;
            await admin
              .executeQuery(
                dialect === "postgresql"
                  ? `SELECT pg_terminate_backend(${id})`
                  : `KILL ${id}`
              )
              .then(() => {
                ended += 1;
              })
              .catch(() => {});
          }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      })();
      run.send("go on");
      const code = await run.exited;
      exited = true;
      await dropping;
      await admin.disconnect();
      // It lost its connections and did not reach its end, however it said so.
      expect(ended).toBeGreaterThan(0);
      expect(run.lines().filter(line => line.startsWith("ended ok"))).toEqual(
        []
      );
      expect(code).not.toBe(0);

      await new Promise(resolve =>
        setTimeout(resolve, (LEASE_SECONDS + 1) * 1000)
      );
      expect(await site.migrateStorage({ dryRun: true })).toMatchObject({
        ran: false,
        lock: { kind: "not-held" },
        stopped: { direction: "up", step: expect.any(Number) },
      });
      await finishesOnce(site, dialect, before);
      expect((await site.marker())?.status).toBe("settled");
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
    }, 300_000);
  }
);
