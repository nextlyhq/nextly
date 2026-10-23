/**
 * The stored language list as the language registry reads it, on each dialect: its fingerprint
 * moves on every write, its rows come back as stored, and a database without the table reads as
 * nothing stored.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { LanguageRegistry } from "../language-registry";
import { storedLanguageReader } from "../stored-language-reader";

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect("the stored language list", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current.destroy();
  });

  async function query(sql: string): Promise<unknown> {
    return (
      current.adapter as unknown as {
        executeQuery(statement: string): Promise<unknown>;
      }
    ).executeQuery(sql);
  }

  /** A stored language, as Settings writes one. */
  async function store(
    code: string,
    position: number,
    isDefault: boolean
  ): Promise<void> {
    const q = (name: string) => quote(dialect, name);
    const flag = (value: boolean) =>
      dialect === "postgresql" ? String(value) : value ? "1" : "0";
    const now = dialect === "sqlite" ? "1700000000" : "CURRENT_TIMESTAMP";
    await query(
      `INSERT INTO ${q("nextly_languages")} (${["code", "label", "direction", "fallback", "position", "is_default", "active", "revision", "created_at", "updated_at"].map(q).join(", ")}) ` +
        `VALUES ('${code}', '${code}', 'ltr', '[]', ${position}, ${flag(isDefault)}, ${flag(true)}, 1, ${now}, ${now})`
    );
  }

  it("is empty with an unmoved fingerprint until a language is stored", async () => {
    const reader = storedLanguageReader(current.adapter);

    expect(await reader.fingerprint()).toBe("0:0");
    expect(await reader.rows()).toEqual([]);
  });

  it("moves its fingerprint when a language is stored, and returns the rows as stored", async () => {
    const reader = storedLanguageReader(current.adapter);
    const before = await reader.fingerprint();

    await store("en", 0, true);
    await store("fr", 1, false);

    expect(await reader.fingerprint()).not.toBe(before);
    const rows = await reader.rows();
    expect(
      rows.map(row => [row.code, Boolean(row.isDefault), Boolean(row.active)])
    ).toEqual(
      expect.arrayContaining([
        ["en", true, true],
        ["fr", false, true],
      ])
    );
  });

  it("tells the registry when the caller is inside an open transaction, so a refresh there reads nothing", async () => {
    const reader = storedLanguageReader(current.adapter);
    const registry = new LanguageRegistry({ reader, ttlMs: 0 });
    await registry.refresh();
    await store("en", 0, true);

    // A read here would run on another pooled connection, which the transaction-escape check
    // fails on PostgreSQL and MySQL; the list stays as it was until the transaction ends.
    const inside = await current.adapter.transaction(async () => {
      await registry.refresh();
      return {
        open: reader.inOpenTransaction?.(),
        codes: registry.current()?.locales.map(locale => locale.code),
      };
    });

    expect(inside).toEqual({ open: true, codes: undefined });
    expect(reader.inOpenTransaction?.()).toBe(false);
    await registry.refresh();
    expect(registry.current()?.locales.map(locale => locale.code)).toEqual([
      "en",
    ]);
  });

  it("reads a database without the table as nothing stored", async () => {
    await query(`DROP TABLE ${quote(dialect, "nextly_languages")}`);
    const reader = storedLanguageReader(current.adapter);

    expect(await reader.fingerprint()).toBe("missing");
    expect(await reader.rows()).toEqual([]);
  });
});
