/**
 * What a handover is allowed to leave behind when its promotion fails.
 *
 * Promoting a provider changes two things: the row taking the default, and
 * every row losing it. Run as separate statements on a pooled connection they
 * commit independently, so a promotion that matches nothing still leaves the
 * demotion committed — and the installation is left with no default provider
 * at all, which is the one state it cannot send from.
 *
 * The two therefore run inside one transaction, with the demotion FIRST --
 * PostgreSQL rejects a second row holding the default as each statement runs,
 * so the incumbent has to give it up before anything can take it. A promotion
 * that then matches nothing throws, which takes the demotion back with it.
 *
 * A write that hands nothing over gets no transaction at all: on SQLite that
 * would be `BEGIN IMMEDIATE` on the one shared connection, and a second
 * ordinary write arriving mid-window could not begin.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getCoreSchema } from "../../../schemas";
import type { Logger } from "../../../services/shared";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { defineEmailProvider } from "../provider-definition";
import { getEmailProviderRegistry } from "../services/email-provider-registry";
import { EmailProviderService } from "../services/email-provider-service";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeAdapter(db: ReturnType<typeof drizzle>): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as DrizzleAdapter;
}

function createEmailProvidersTable(sqlite: Database.Database): void {
  const { tables } = getCoreSchema("sqlite");
  const spec = tables.find(table => table.name === "email_providers");
  if (!spec) {
    expect.fail(
      "email_providers is absent from the core schema — this fixture can no longer be derived from it."
    );
  }
  sqlite.exec(
    `CREATE TABLE "email_providers" (\n${createTableBody(spec, (id: string) => `"${id}"`)}\n)`
  );
}

describe("a promotion whose row disappears first", () => {
  let sqlite: Database.Database;
  let service: EmailProviderService;
  /** Set to an id to have the next config parse delete that row. */
  let deleteDuringParse: string | null = null;

  /**
   * A provider whose parser deletes a row on its way through.
   *
   * `updateProvider` reads the stored row, then parses the merged
   * configuration, then writes. Deleting from inside the parser puts the
   * delete exactly where a concurrent request would land it: after the read
   * this update is built from, and before the statement that applies it.
   */
  const vanishing = defineEmailProvider({
    type: "vanishing",
    label: "Vanishing",
    configFields: [],
    parseConfig: input => {
      if (deleteDuringParse !== null) {
        sqlite
          .prepare(`DELETE FROM "email_providers" WHERE "id" = ?`)
          .run(deleteDuringParse);
        deleteDuringParse = null;
      }
      return (input ?? {}) as Record<string, unknown>;
    },
    createAdapter: () => ({
      send: () => Promise.resolve({ success: true, messageId: "x" }),
    }),
  });

  beforeEach(() => {
    deleteDuringParse = null;
    sqlite = new Database(":memory:");
    createEmailProvidersTable(sqlite);
    service = new EmailProviderService(
      makeAdapter(drizzle({ client: sqlite })),
      logger
    );
    getEmailProviderRegistry().register(vanishing);
  });

  afterEach(() => {
    sqlite.close();
    getEmailProviderRegistry().reset();
  });

  /** Every provider the table currently records as the default. */
  function defaultIds(): string[] {
    return sqlite
      .prepare(`SELECT "id" FROM "email_providers" WHERE "is_default" = 1`)
      .all()
      .map(row => (row as { id: string }).id);
  }

  it("leaves the standing default alone", async () => {
    const holder = await service.createProvider({
      name: "Holder",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: true,
      isActive: true,
    });
    const challenger = await service.createProvider({
      name: "Challenger",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: false,
      isActive: true,
    });

    deleteDuringParse = challenger.id;
    // The row is gone by the time the update reaches it, so the caller is told
    // so. What the caller is told is not the point here; what the table is
    // left holding is.
    await expect(
      service.updateProvider(challenger.id, {
        isDefault: true,
        configuration: {},
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The promotion matched nothing, so nothing may have moved. A demotion
    // left committed here takes the default off `holder` and gives it to no
    // one, and the installation can no longer send an unrouted message at all.
    expect(defaultIds()).toEqual([holder.id]);
  });

  it("lets two ordinary writes overlap", async () => {
    // Neither of these hands the default over, so neither has anything to make
    // atomic WITH. Opening a transaction anyway is not free on SQLite:
    // `withTransaction` issues `BEGIN IMMEDIATE` on the one shared connection,
    // so a second write arriving between the first BEGIN and its COMMIT cannot
    // begin at all and is refused — on the most ordinary path there is.
    const outcomes = await Promise.allSettled([
      service.createProvider({
        name: "A",
        type: "vanishing",
        fromEmail: "noreply@example.com",
        fromName: null,
        configuration: {},
        isDefault: false,
        isActive: true,
      }),
      service.createProvider({
        name: "B",
        type: "vanishing",
        fromEmail: "noreply@example.com",
        fromName: null,
        configuration: {},
        isDefault: false,
        isActive: true,
      }),
    ]);

    expect(outcomes.map(outcome => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("keeps the standing default when setDefault's target disappears", async () => {
    // The delete has to land INSIDE the window, not before it: `setDefault`
    // reads the row first, so a row deleted beforehand fails at that read and
    // never reaches the transaction at all.
    //
    // Placed by intercepting the demotion — the statement immediately before
    // the promotion — so the row is gone by the time the promoting update
    // runs. Nothing locks it, so this is exactly what a concurrent delete
    // committed on another connection does.
    const holder = await service.createProvider({
      name: "Holder",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: true,
      isActive: true,
    });
    const challenger = await service.createProvider({
      name: "Challenger",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: false,
      isActive: true,
    });

    const db = drizzle({ client: sqlite });
    let updates = 0;
    const deletingBetween = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== "update") {
          return Reflect.get(target, property, receiver) as unknown;
        }
        return (table: unknown) => {
          const builder = (
            target as unknown as {
              update: (t: unknown) => { set: (v: unknown) => unknown };
            }
          ).update(table);
          return {
            set: (values: unknown) => {
              const step = builder.set(values) as {
                where: (c: unknown) => Promise<unknown>;
              };
              return {
                where: async (condition: unknown) => {
                  const result = await step.where(condition);
                  updates += 1;
                  // After the demotion, before the promotion.
                  if (updates === 1) {
                    sqlite
                      .prepare(`DELETE FROM "email_providers" WHERE "id" = ?`)
                      .run(challenger.id);
                  }
                  return result;
                },
              };
            },
          };
        };
      },
    }) as ReturnType<typeof drizzle>;

    const racing = new EmailProviderService(
      makeAdapter(deletingBetween),
      logger
    );

    await expect(racing.setDefault(challenger.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // The precondition, asserted rather than assumed: without a second
    // statement the promotion never ran and this describes the wrong path.
    expect(updates).toBe(2);
    expect(defaultIds()).toEqual([holder.id]);
  });

  it("still hands the default over when the row is there", async () => {
    // The control. A service that had simply stopped demoting anything would
    // pass the case above while breaking every promotion that works, so this
    // has to fail for a fix that over-corrects.
    const holder = await service.createProvider({
      name: "Holder",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: true,
      isActive: true,
    });
    const challenger = await service.createProvider({
      name: "Challenger",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: false,
      isActive: true,
    });

    await service.updateProvider(challenger.id, {
      isDefault: true,
      configuration: {},
    });

    expect(defaultIds()).toEqual([challenger.id]);
    expect(defaultIds()).not.toContain(holder.id);
  });

  it("never records two defaults after a create takes over", async () => {
    // The other promoting path. `createProvider` inserts and then demotes, so
    // the moment between them holds two defaults inside the transaction and
    // exactly one outside it.
    await service.createProvider({
      name: "First",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: true,
      isActive: true,
    });
    const second = await service.createProvider({
      name: "Second",
      type: "vanishing",
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {},
      isDefault: true,
      isActive: true,
    });

    expect(defaultIds()).toEqual([second.id]);
  });
});
