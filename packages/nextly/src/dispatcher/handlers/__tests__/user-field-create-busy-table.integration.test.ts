/**
 * A user field created in the Schema Builder while another session holds `user_ext` waits for it
 * in short tries, then stops as table busy; the field is then not created at all, its definition
 * taken back with its column, so the same create can be made again once the table is free.
 *
 * On PostgreSQL and MySQL, where the holder is an open transaction that has read `user_ext`. On
 * SQLite a holder holds the whole database, so the definition's own write would meet it before the
 * column does, and no busy stop could be told apart from it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { UserFieldDefinitionService } from "../../../domains/users/services/user-field-definition-service";
import { NextlyError } from "../../../errors/nextly-error";
import { dispatchUserFields } from "../user-field-dispatcher";

const SERVERS = getConfiguredTestDialects().filter(
  dialect => dialect !== "sqlite"
);

describe.each(SERVERS)(
  "a user field created while user_ext is busy (%s)",
  dialect => {
    let handle: TestNextly;
    let adapter: DrizzleAdapter;
    let free: () => void = () => {};
    let holding: Promise<unknown> = Promise.resolve();

    beforeEach(async () => {
      // The Builder runs its DDL in development; short bounds, so the tries run in seconds.
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
      vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "4");
      handle = await createTestNextly({ dialect, collections: [] });
      adapter = handle.adapter as unknown as DrizzleAdapter;
    }, 120_000);

    afterEach(async () => {
      free();
      await holding.catch(() => {});
      await handle?.destroy();
      vi.unstubAllEnvs();
    }, 60_000);

    const definitions = () =>
      handle.getService(
        "userFieldDefinitionService"
      ) as unknown as UserFieldDefinitionService;

    /** A second session's open transaction that has read `user_ext`, until `free()`. */
    async function holdUserExt(): Promise<void> {
      let held: () => void = () => {};
      const isHeld = new Promise<void>(resolve => {
        held = resolve;
      });
      const freed = new Promise<void>(resolve => {
        free = resolve;
      });
      holding = adapter.transaction(async tx => {
        await tx.execute("SELECT 1 FROM user_ext");
        held();
        await freed;
      });
      await isHeld;
    }

    const create = (name: string) =>
      dispatchUserFields(
        "createField",
        {},
        { name, label: name, type: "text" }
      );

    it("stops as table busy, keeps no definition, and creates it once the table is free", async () => {
      // `user_ext` exists, with a field of its own.
      await create("ufbFirst");
      await holdUserExt();
      const refused = await create("ufbSecond").then(
        () => undefined,
        (e: unknown) => e
      );
      free();
      await holding.catch(() => {});
      expect(NextlyError.is(refused) ? refused.code : refused).toBe(
        "NEXTLY_TABLE_BUSY"
      );
      expect((await definitions().listFields()).map(f => f.name)).not.toContain(
        "ufbSecond"
      );

      await create("ufbSecond");
      expect((await definitions().listFields()).map(f => f.name)).toContain(
        "ufbSecond"
      );
    }, 60_000);
  }
);
