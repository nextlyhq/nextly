/**
 * `migrate:field-groups --apply` killed part-way is finished by the next run, from what the live
 * database holds: the next preview says a run stopped and where, and the next `--apply` finishes
 * it, every group readable under the current names with its content.
 *
 * The run is a process of its own (`helpers/migration-stop-child.ts`) that kills itself at a named
 * stop point (`NEXTLY_TEST_KILL_AT`): during the content rewrite, after one batch has committed and
 * before its progress is recorded, and, on MySQL, where each rename commits on its own, between two
 * renames. A kill is what an operator's run meets when its process or host dies, and it leaves no
 * chance to record anything on the way out.
 *
 * What separates a correct resume from a plausibly broken one:
 * - a resume that trusted the recorded step alone would skip the batch the kill interrupted, or
 *   rename again what the database already holds under its new name; here every row ends as one
 *   complete rewrite would leave it (the ledger check the run's own settlement makes), and each
 *   group has exactly the rows it had;
 * - a preview that read only a settled marker would report a stopped run as "not running".
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

      // The next preview reports the stopped run.
      const preview = await site.migrateStorage({ dryRun: true });
      expect(preview).toMatchObject({
        ran: false,
        stopped: { direction: "up", step: expect.any(Number) },
      });

      // The next --apply finishes from it, once the killed run's lease has lapsed.
      await new Promise(resolve =>
        setTimeout(resolve, (LEASE_SECONDS + 1) * 1000)
      );
      expect((await site.migrateStorage()).ran).toBe(true);
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
