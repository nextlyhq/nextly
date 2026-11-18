/**
 * `nextly migrate` brings the data an earlier release stored up to date.
 *
 * An earlier release kept a password inside a group as it was written.
 * `nextly migrate` hashes it once its migrations have applied, under the
 * schema lock, and only once a backup is confirmed (`--backup-confirmed`, or
 * a yes at a terminal). Without the confirmation, and with nobody to ask, it
 * changes nothing, a pending migration included, and names the flag.
 *
 * Each case builds the database the way a site gets one: `migrate:create`
 * and `nextly migrate` from a configuration, then a row stored the way the
 * earlier release left it, and a second migration waiting to apply. What
 * would separate a correct run from a broken one:
 *
 * - a refusal that applied the waiting migration first;
 * - a confirmed run that applied the migration and left the password as
 *   written, or stored something the password no longer verifies against;
 * - a database with nothing of the kind asked for a backup it does not need;
 * - a dry run that hashes, or that names no work.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { isPasswordHash, verifyPassword } from "../../../auth/password";
import {
  defineCollection,
  defineConfig,
  group,
  password,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { NextlyError } from "../../../errors";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];
type Row = Record<string, unknown>;

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

const TABLE = "dc_msd_entries";
const STEP = "hash passwords stored before this release";

/** The site's collection, with or without the field its second migration adds. */
function configWith(summary: boolean) {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "msd-entries",
        fields: [
          text({ name: "title" }),
          group({
            name: "box",
            fields: [text({ name: "label" }), password({ name: "pin" })],
          }),
          ...(summary ? [text({ name: "summary" })] : []),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate on a database holding a password stored as written (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let clock = 0;
    const q = dialect === "mysql" ? "`" : '"';
    const id = (name: string) => `${q}${name}${q}`;

    /** Each migration file is named by the clock, so each gets a second of its own. */
    function tick(): void {
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 18, 9, 0, clock, 0)));
    }

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      clock = 0;
      tick();
      state.dir = mkdtempSync(join(tmpdir(), "nextly-migrate-stored-"));
      mkdirSync(join(state.dir, "migrations"));
      state.config = configWith(false);
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_msd");
        url = scratch.url;
        drop = () => scratch.drop();
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
    }, 60_000);

    afterEach(async () => {
      setNonInteractive(false);
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    });

    /** A command's context, with everything it says captured. */
    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    function messageOf(error: unknown): string {
      return NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);
    }

    /** With a connection of the test's own, closed after. */
    async function on<T>(fn: (adapter: DrizzleAdapter) => Promise<T>) {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    const sql = (statement: string) =>
      on(adapter => adapter.executeQuery<Row>(statement));

    /** `nextly migrate` with `options`: what it said. It throws what it refused with. */
    async function migrate(
      options: { backupConfirmed?: boolean; dryRun?: boolean } = {}
    ): Promise<string[]> {
      const { context, said } = command();
      await runMigrate(
        { cwd: state.dir, throwOnFailure: true, ...options },
        context
      );
      return said;
    }

    /** `migrate:create` for the configuration as it stands. */
    async function capture(name: string): Promise<void> {
      tick();
      const { context, said } = command();
      try {
        await runMigrateCreate(name, { cwd: state.dir }, context);
      } catch (error) {
        throw new Error(
          `migrate:create failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
    }

    /**
     * A site on this release whose one entry holds `pin` as an earlier
     * release stored it, with a second migration, adding `summary`, captured
     * and not yet applied.
     */
    async function siteHoldingAPlainPassword(pin: string): Promise<void> {
      setNonInteractive(true);
      await capture("entries");
      await migrate();
      const now =
        dialect === "sqlite" ? String(Date.now()) : "CURRENT_TIMESTAMP";
      const box = JSON.stringify({ label: "front door", pin });
      await sql(
        `INSERT INTO ${id(TABLE)} (${id("id")}, ${id("title")}, ${id("slug")}, ${id("box")}, ${id("created_at")}, ${id("updated_at")}) VALUES ('entry-1', 'first', 'first', '${box}', ${now}, ${now})`
      );
      state.config = configWith(true);
      await capture("summary");
    }

    /** The password the entry holds now. */
    async function storedPin(): Promise<unknown> {
      const [row] = await sql(
        `SELECT ${id("box")} AS box FROM ${id(TABLE)} WHERE ${id("id")} = 'entry-1'`
      );
      const box = row?.box;
      const open = (typeof box === "string" ? JSON.parse(box) : box) as Row;
      return open.pin;
    }

    /** Whether the second migration has applied: the column it adds is there. */
    async function summaryColumnExists(): Promise<boolean> {
      try {
        await sql(`SELECT ${id("summary")} FROM ${id(TABLE)}`);
        return true;
      } catch {
        return false;
      }
    }

    it("changes nothing and names --backup-confirmed with no confirmation and nobody to ask", async () => {
      await siteHoldingAPlainPassword("plain-pin");
      // The fixture's controls: the password is held as written, and the
      // second migration is waiting.
      expect(await storedPin()).toBe("plain-pin");
      expect(await summaryColumnExists()).toBe(false);

      const refusal = await migrate().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(NextlyError.is(refusal)).toBe(true);
      expect(messageOf(refusal)).toContain("`nextly migrate --backup-confirmed`");
      expect(messageOf(refusal)).toContain(STEP);
      expect(await storedPin()).toBe("plain-pin");
      expect(await summaryColumnExists()).toBe(false);
    }, 240_000);

    it("applies the migration and hashes the password once the backup is confirmed, then has nothing left to do", async () => {
      await siteHoldingAPlainPassword("plain-pin");

      const said = await migrate({ backupConfirmed: true });

      expect(await summaryColumnExists()).toBe(true);
      const stored = await storedPin();
      expect(isPasswordHash(stored)).toBe(true);
      expect(await verifyPassword("plain-pin", String(stored))).toBe(true);
      expect(said).toContain(`${STEP}: 1`);
      // Counts only: the password itself is never said.
      expect(said.join("\n")).not.toContain("plain-pin");

      // A second run finds nothing of the kind: no confirmation is needed
      // with nobody to ask, the stored hash stays, and the step is not named.
      const again = await migrate();
      expect(await storedPin()).toBe(stored);
      expect(again.join("\n")).not.toContain(STEP);
    }, 240_000);

    it("lists the work in a dry run and changes nothing", async () => {
      await siteHoldingAPlainPassword("plain-pin");

      const said = await migrate({ dryRun: true, backupConfirmed: true });

      expect(said.join("\n")).toContain(`${STEP}: 1`);
      expect(await storedPin()).toBe("plain-pin");
      expect(await summaryColumnExists()).toBe(false);
    }, 240_000);
  }
);
