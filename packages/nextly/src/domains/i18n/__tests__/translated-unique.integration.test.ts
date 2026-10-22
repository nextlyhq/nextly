/**
 * A translated field marked unique is unique within each language, on each dialect: the same value
 * is refused twice in one language and allowed in two, values left blank are never duplicates, and
 * what a read returns for a blank is exactly what it returned before the rule.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

describeEachDialect("a translated unique field", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder applies a collection's migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: ["en", "fr"], defaultLocale: "en" },
    });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  function handler(): CollectionsHandler {
    return current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
  }

  async function seedCollection(): Promise<void> {
    const created = await handler().createCollection({
      name: "pages",
      label: "Page",
      localized: true,
      fields: [
        { name: "handle", type: "text", unique: true },
        { name: "note", type: "text" },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
  }

  async function write(
    locale: string,
    data: Record<string, unknown>,
    entryId?: string
  ) {
    const entries = handler().getEntryService();
    return entryId
      ? entries.updateEntry(
          { collectionName: "pages", entryId, overrideAccess: true, locale },
          data
        )
      : entries.createEntry(
          { collectionName: "pages", overrideAccess: true, locale },
          data
        );
  }

  const idOf = (result: { data?: unknown }) =>
    String((result.data as { id: unknown }).id);

  it("refuses the same value twice in one language, and allows it in another", async () => {
    await seedCollection();
    const first = await write("en", { handle: "about" });
    expect(first.success, JSON.stringify(first)).toBe(true);

    const second = await write("en", { handle: "about" });
    expect(second.success).toBe(false);
    expect(second).toMatchObject({ statusCode: 409 });

    const french = await write("en", { handle: "a-propos" });
    expect(french.success, JSON.stringify(french)).toBe(true);
    const sameInFrench = await write("fr", { handle: "about" }, idOf(french));
    expect(sameInFrench.success, JSON.stringify(sameInFrench)).toBe(true);
  });

  it("never treats values left blank as duplicates, and reads a blank as it read before", async () => {
    await seedCollection();
    const a = await write("en", { handle: "", note: "" });
    const b = await write("en", { handle: "", note: "" });
    expect(a.success, JSON.stringify(a)).toBe(true);
    expect(b.success, JSON.stringify(b)).toBe(true);

    // The unique field reads back exactly as the ordinary translated field beside it does.
    const read = await handler()
      .getEntryService()
      .getEntry({
        collectionName: "pages",
        entryId: idOf(b),
        overrideAccess: true,
        locale: "en",
      });
    const data = read.data as Record<string, unknown>;
    expect(data.handle).toEqual(data.note);
  });
});
