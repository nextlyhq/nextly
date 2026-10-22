/**
 * The site's languages as Settings changes them, on each dialect: nothing is written until a
 * change is made, adding a language needs no schema change and reaches the registry at once, a
 * removed language is kept and comes back, the default is never removed, and a configuration that
 * declares the languages locks them.
 */
import { afterEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { LanguageRegistry } from "../language-registry";
import { LanguageSettingsService } from "../services/language-settings-service";

describeEachDialect("the site's languages in Settings", dialect => {
  let current: TestNextly | undefined;

  afterEach(async () => {
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
