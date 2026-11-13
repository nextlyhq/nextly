/**
 * The localization paths' schema statements wait for a busy table in short tries, then stop with
 * `NEXTLY_TABLE_BUSY`, rather than waiting without bound: an entity's companion drop on delete
 * (`teardownEntityI18n`) and the archive's setup (`ensureI18nArchive`).
 *
 * On SQLite, the dialect this file runs on, the holder is an open write transaction on a second
 * connection to the same file, which holds the whole database. The bounds are shortened through
 * the environment (one second a try), so each case ends in seconds.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lockWorld,
  type LockWorld,
} from "../../../schema/pipeline/__tests__/helpers/schema-lock-world";
import { ensureI18nArchive } from "../ensure-archive";
import { teardownEntityI18n } from "../teardown-entity-i18n";

const PREFIX = `cbt_${randomBytes(4).toString("hex")}`;
const MAIN = `${PREFIX}_posts`;
const COMPANION = `${MAIN}_locales`;
/** The table the holder writes to, so its transaction takes the database's write lock. */
const HELD = `${PREFIX}_held`;
const ARCHIVE = "nextly_i18n_archive";

describe("localization schema statements waiting for a busy table on sqlite", () => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let holderAdapter: DrizzleAdapter;
  let free: () => void = () => {};
  let holding: Promise<unknown> = Promise.resolve();

  beforeEach(async () => {
    world = await lockWorld("sqlite");
    adapter = await world.connect();
    holderAdapter = await world.connect();
    await adapter.executeQuery(`CREATE TABLE ${HELD} (id integer)`);
    await adapter.executeQuery(`CREATE TABLE ${COMPANION} (id integer)`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    free();
    await holding.catch(() => {});
    await holderAdapter.disconnect();
    await world.reset(adapter, [HELD, COMPANION, ARCHIVE]);
    await adapter.disconnect();
    await world.dispose();
  });

  /** The second connection holds the database's write lock until `free()`. */
  async function holdTheDatabase(): Promise<void> {
    let held: () => void = () => {};
    const isHeld = new Promise<void>(resolve => {
      held = resolve;
    });
    const freed = new Promise<void>(resolve => {
      free = resolve;
    });
    holding = holderAdapter.transaction(async ctx => {
      await ctx.queryStatement(
        sql.raw(`INSERT INTO ${HELD} (id) VALUES (0) RETURNING id`)
      );
      held();
      await freed;
    });
    await isHeld;
  }

  /** One try of a second; a total of three leaves room for a try or two, then the stop. */
  function shortTries(): void {
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "3");
  }

  it("an entity's companion drop stops with NEXTLY_TABLE_BUSY naming the table, the companion kept", async () => {
    await holdTheDatabase();
    shortTries();

    const stopped = await teardownEntityI18n({
      adapter,
      slug: null,
      tableName: MAIN,
    }).catch((error: unknown) => error);

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          change: `the localization teardown: the drop of table "${COMPANION}"`,
          ended: { table: COMPANION },
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    free();
    await holding;
    expect(await adapter.tableExists(COMPANION)).toBe(true);
  }, 20_000);

  it("the archive's setup stops with NEXTLY_TABLE_BUSY, the archive not created", async () => {
    await holdTheDatabase();
    shortTries();

    const stopped = await ensureI18nArchive(adapter, "sqlite").catch(
      (error: unknown) => error
    );

    expect(stopped).toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
      logContext: {
        stop: {
          change: "the localization archive's setup: statement 1 of 1",
          ended: { table: ARCHIVE },
          outcome: { kind: "nothing-changed" },
        },
      },
    });
    free();
    await holding;
    expect(await adapter.tableExists(ARCHIVE)).toBe(false);
  }, 20_000);
});
