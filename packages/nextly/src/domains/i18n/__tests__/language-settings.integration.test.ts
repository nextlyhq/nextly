/**
 * The site's languages as Settings changes them, on each dialect: nothing is written until a
 * change is made, adding a language needs no schema change and reaches the registry at once, a
 * removed language is kept and comes back, the default is never removed, and a configuration that
 * declares the languages locks them.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { LanguageRegistry } from "../language-registry";
import { storedLanguageReader } from "../stored-language-reader";
import { LanguageSettingsService } from "../services/language-settings-service";

describeEachDialect("the site's languages in Settings", dialect => {
  let current: TestNextly | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await current?.destroy();
    current = undefined;
  });

  async function boot(localization?: {
    locales: string[];
    defaultLocale: string;
  }) {
    current = await createTestNextly({
      dialect,
      collections: [],
      ...(localization ? { localization } : {}),
    });
    const registry = current.getService("languageRegistry") as LanguageRegistry;
    return {
      registry,
      settings: new LanguageSettingsService(current.adapter, registry),
    };
  }

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current!.adapter as unknown as {
        executeQuery<R>(s: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  async function storedRows(): Promise<number> {
    const [row] = await query<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${dialect === "mysql" ? "`nextly_languages`" : '"nextly_languages"'}`
    );
    return Number(row?.n ?? 0);
  }

  /** Every table and column the database has, to show a change ran no DDL. */
  async function shape(d: TestDialect): Promise<string> {
    const rows =
      d === "sqlite"
        ? await query<{ name: string; sql: string | null }>(
            `SELECT name, sql FROM sqlite_master ORDER BY name`
          )
        : await query<{ t: string; c: string }>(
            d === "mysql"
              ? `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1, 2`
              : `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2`
          );
    return JSON.stringify(rows);
  }

  it("shows English alone and writes nothing until a change is made", async () => {
    const { registry, settings } = await boot();

    const list = await settings.list();

    expect(list.lockedByConfig).toBe(false);
    expect(list.languages.map(l => [l.code, l.isDefault])).toEqual([
      ["en", true],
    ]);
    expect(await storedRows()).toBe(0);
    expect(registry.current()).toBeUndefined();
  });

  it("adds a language with no schema change, and the registry serves it at once", async () => {
    const { registry, settings } = await boot();
    const before = await shape(dialect);

    const list = await settings.change({
      kind: "add",
      code: "fr",
      label: "French",
    });

    expect(list.languages.filter(l => l.active).map(l => l.code)).toEqual([
      "en",
      "fr",
    ]);
    expect(registry.current()?.locales.map(l => l.code)).toEqual(["en", "fr"]);
    expect(await shape(dialect)).toBe(before);
  });

  it("keeps a removed language and brings it back when added again", async () => {
    const { registry, settings } = await boot();
    await settings.change({ kind: "add", code: "fr", label: "French" });

    const removed = await settings.change({ kind: "remove", code: "fr" });
    expect(removed.languages.find(l => l.code === "fr")?.active).toBe(false);
    expect(registry.current()?.locales.map(l => l.code)).toEqual(["en"]);

    await settings.change({ kind: "add", code: "fr", label: "French" });
    expect(registry.current()?.locales.map(l => l.code)).toEqual(["en", "fr"]);
    expect(await storedRows()).toBe(2);
  });

  it("reaches another instance on the same database within its interval", async () => {
    const { settings } = await boot();
    // Another server: its own registry, reading the same database, as every instance's does.
    let now = 0;
    const elsewhere = new LanguageRegistry({
      reader: storedLanguageReader(current!.adapter),
      ttlMs: 1000,
      now: () => now,
    });
    await elsewhere.refresh();
    expect(elsewhere.current()).toBeUndefined();

    await settings.change({ kind: "add", code: "fr", label: "French" });

    // Within the interval the other instance still serves what it read...
    await elsewhere.refresh();
    expect(elsewhere.current()).toBeUndefined();
    // ...and once it has passed, the next request's refresh brings the change.
    now = 1500;
    await elsewhere.refresh();
    expect(elsewhere.current()?.locales.map(l => l.code)).toEqual(["en", "fr"]);
  });

  /** One column of every stored language, by code, as the database holds it now. */
  async function storedColumn(column: string): Promise<Record<string, number>> {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const rows = await query<{
      code: string;
      value: number | string | boolean;
    }>(
      `SELECT ${q("code")} AS code, ${q(column)} AS value FROM ${q("nextly_languages")}`
    );
    return Object.fromEntries(rows.map(row => [row.code, Number(row.value)]));
  }

  // Two changes made at the same moment, each held after its read until the other has read too or
  // it is clear the other cannot read yet. Planned from the same rows, they would both write the
  // same next revision (leaving the fingerprint where the first left it, so an instance that read
  // between them never reads the second), or both keep the default they each set.
  it.each([
    {
      shape: "two edits of one language",
      changes: [
        { kind: "update", code: "fr", label: "Français" },
        { kind: "update", code: "fr", label: "French (France)" },
      ] as const,
      holds: async (before: Record<string, number>) =>
        expect((await storedColumn("revision")).fr).toBe(before.fr! + 2),
    },
    {
      shape: "two default changes",
      changes: [
        { kind: "setDefault", code: "fr" },
        { kind: "setDefault", code: "de" },
      ] as const,
      holds: async () => {
        const defaults = Object.entries(await storedColumn("is_default"))
          .filter(([, isDefault]) => isDefault === 1)
          .map(([code]) => code);
        expect(defaults).toHaveLength(1);
      },
    },
  ])(
    "applies $shape made at the same moment one after the other",
    async ({ changes, holds }) => {
      const { settings } = await boot();
      await settings.change({ kind: "add", code: "fr", label: "French" });
      await settings.change({ kind: "add", code: "de", label: "German" });
      const before = await storedColumn("revision");
      const held = new LanguageSettingsService(
        heldAfterFirstReads(current!.adapter, 2),
        current!.getService("languageRegistry") as LanguageRegistry
      );

      await Promise.all(changes.map(change => held.change(change)));

      await holds(before);
    }
  );

  // With nothing stored, a change's locked read locks no row, so two first changes both plan
  // from the implicit English list and both insert it. The second is run again once the first has
  // committed, in a transaction of its own, and plans from what the first stored.
  it("applies two first changes made at the same moment on a site with nothing stored", async () => {
    const { registry } = await boot();
    const held = new LanguageSettingsService(
      heldAfterFirstReads(current!.adapter, 2),
      registry
    );

    await Promise.all([
      held.change({ kind: "add", code: "fr", label: "French" }),
      held.change({ kind: "add", code: "de", label: "German" }),
    ]);

    expect(
      registry
        .current()
        ?.locales.map(l => l.code)
        .sort()
    ).toEqual(["de", "en", "fr"]);
    expect(await storedRows()).toBe(3);
  });

  // The rows are committed by then, so a failure after it must not read as the change failing:
  // retried, an add would be refused as a duplicate of itself.
  it("answers a committed change with the list it wrote when the refresh after it fails", async () => {
    const { registry, settings } = await boot();
    vi.spyOn(registry, "refresh").mockRejectedValueOnce(
      new Error("the database went away")
    );

    const list = await settings.change({
      kind: "add",
      code: "fr",
      label: "French",
    });

    expect(list.languages.filter(l => l.active).map(l => l.code)).toEqual([
      "en",
      "fr",
    ]);
    expect(await storedRows()).toBe(2);
  });

  it("refuses to remove the default language", async () => {
    const { settings } = await boot();
    await settings.change({ kind: "add", code: "fr", label: "French" });

    await expect(
      settings.change({ kind: "remove", code: "en" })
    ).rejects.toMatchObject({
      publicData: {
        errors: [expect.objectContaining({ code: "default_language" })],
      },
    });
  });

  it("shows a configuration's languages and refuses to change them", async () => {
    const { settings } = await boot({
      locales: ["en", "de"],
      defaultLocale: "en",
    });

    const list = await settings.list();
    expect(list.lockedByConfig).toBe(true);
    expect(list.languages.map(l => l.code)).toEqual(["en", "de"]);
    await expect(
      settings.change({ kind: "add", code: "fr", label: "French" })
    ).rejects.toMatchObject({
      publicData: {
        errors: [
          expect.objectContaining({ code: "languages_locked_by_config" }),
        ],
      },
    });
    expect(await storedRows()).toBe(0);
  });
});

/**
 * The adapter, with each of the first `parties` reads made inside a transaction held once it has
 * its rows, until every one of them has read or half a second has passed. Changes that do not
 * lock what they read all get past their read before any writes; a change that does lock it makes
 * the next one wait at its read until it has committed.
 */
function heldAfterFirstReads(
  adapter: DrizzleAdapter,
  parties: number
): DrizzleAdapter {
  let reads = 0;
  let release: () => void = () => {};
  const allRead = new Promise<void>(resolve => {
    release = resolve;
  });
  const hold = () =>
    Promise.race([
      allRead,
      new Promise<void>(resolve => setTimeout(resolve, 500)),
    ]);
  const holdingReads = <T extends object>(tx: T): T =>
    new Proxy(tx, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        if (property !== "select" || reads >= parties) {
          return value.bind(target);
        }
        return async (...args: unknown[]) => {
          const rows: unknown = await Reflect.apply(value, target, args);
          reads += 1;
          if (reads >= parties) release();
          await hold();
          return rows;
        };
      },
    });
  return new Proxy(adapter, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property !== "transaction") return value.bind(target);
      return (work: (tx: object) => Promise<unknown>, ...rest: unknown[]) =>
        Reflect.apply(value, target, [
          (tx: object) => work(holdingReads(tx)),
          ...rest,
        ]);
    },
  });
}
