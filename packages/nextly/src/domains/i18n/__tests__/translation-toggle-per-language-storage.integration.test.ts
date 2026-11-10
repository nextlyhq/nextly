/**
 * Turning translation on or off for a Draft/Published entity on a site that keeps every
 * translatable field per language (`experimental.perLanguageStorage`).
 *
 * The values stay where they are: the entity kept them per language before and keeps them so
 * after. What changes is whether each language publishes on its own, so the per-language table
 * gains or loses its `_status`:
 * - turned on, every language takes the entry's publish state, since every language was live
 *   with the entry until then;
 * - turned off, the per-language states are dropped, but only where each one agrees with the
 *   entry's; otherwise the change is refused, naming how many entries disagree, so no language's
 *   state is lost in silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineSingle, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";

let current: TestNextly | undefined;

beforeEach(() => {
  // The Schema Builder applies what it changes in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

const FIELDS = [{ name: "heading", type: "text" }];

/** The two Builder paths that turn a Single's translation on or off. */
const PATHS = ["its schema dialog", "its settings"] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    PATHS.map(path => [dialect, path] as const)
  )
)(
  "turning translation on and off under per-language storage (%s, through %s)",
  (dialect: TestDialect, path: (typeof PATHS)[number]) => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const run = (sql: string) => current!.adapter.executeQuery(sql);

    /** A published, untranslated Draft/Published Single made in the Builder, in two languages. */
    async function seeded(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        // A code-first neighbour, so the site has content before the Builder adds its own.
        singles: [
          defineSingle({ slug: "site", fields: [text({ name: "x" })] }),
        ],
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "hero", label: "Hero", status: true, fields: FIELDS }
      );
      const singles: SingleEntryService =
        current.getService("singleEntryService");
      for (const [locale, heading] of [
        ["en", "Hello"],
        ["de", "Hallo"],
      ] as const) {
        const written = await singles.update(
          "hero",
          { heading, _overwrite: true },
          { overrideAccess: true, locale }
        );
        expect(written.success, JSON.stringify(written)).toBe(true);
      }
      await run(`UPDATE ${q("single_hero")} SET ${q("status")} = 'published'`);
      return current;
    }

    async function toggle(localized: boolean): Promise<unknown> {
      const [row] = await current!.adapter.executeQuery<{
        version: number | string | null;
      }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'hero'`
      );
      return path === "its schema dialog"
        ? dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "hero" },
            {
              fields: FIELDS,
              confirmed: true,
              localized,
              schemaVersion: Number(row?.version ?? 1),
            }
          )
        : dispatchSingles(
            "updateSingleSchema",
            { slug: "hero" },
            { localized }
          );
    }

    async function companionColumns(): Promise<string[]> {
      const snapshot = await introspectLiveSnapshot(
        current!.adapter.getDrizzle(),
        current!.adapter.dialect,
        ["single_hero_locales"]
      );
      return (
        snapshot.tables[0]?.columns.map(column => column.name.toLowerCase()) ??
        []
      );
    }

    async function statesByLanguage(): Promise<Record<string, unknown>> {
      const rows = await current!.adapter.executeQuery<{
        locale: string;
        state: unknown;
      }>(
        `SELECT ${q("_locale")} AS locale, ${q("_status")} AS state FROM ${q("single_hero_locales")}`
      );
      return Object.fromEntries(rows.map(row => [row.locale, row.state]));
    }

    async function headingIn(locale: string): Promise<unknown> {
      const read = await current!.nextly.findSingle({
        slug: "hero",
        locale,
      } as never);
      return (read as { heading?: unknown }).heading;
    }

    it("gives every language the entry's publish state when translation is turned on, and moves no value", async () => {
      await seeded();
      expect(await companionColumns()).not.toContain("_status");

      await toggle(true);

      expect(await companionColumns()).toContain("_status");
      expect(await statesByLanguage()).toEqual({
        en: "published",
        de: "published",
      });
      expect(await headingIn("de")).toBe("Hallo");
      expect(await headingIn("en")).toBe("Hello");
    });

    it("refuses turning translation off while a language's publish state differs from the entry's", async () => {
      await seeded();
      await toggle(true);
      await run(
        `UPDATE ${q("single_hero_locales")} SET ${q("_status")} = 'draft' WHERE ${q("_locale")} = 'de'`
      );

      const refused = await toggle(false).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(JSON.stringify(refused)).toContain(
        "1 entry has a language whose publish state differs from the entry's"
      );
      // Nothing changed: each language keeps its own state.
      expect(await companionColumns()).toContain("_status");
      expect(await statesByLanguage()).toEqual({
        en: "published",
        de: "draft",
      });
    });

    it("drops the per-language states when translation is turned off and they agree, and moves no value", async () => {
      await seeded();
      await toggle(true);

      await toggle(false);

      expect(await companionColumns()).not.toContain("_status");
      expect(await headingIn("de")).toBe("Hallo");
      expect(await headingIn("en")).toBe("Hello");
    });
  }
);

/** The two Builder paths that turn a collection's translation on or off. */
const COLLECTION_PATHS = ["its schema dialog", "its settings"] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    COLLECTION_PATHS.map(path => [dialect, path] as const)
  )
)(
  "turning a collection's translation on and off under per-language storage (%s, through %s)",
  (dialect: TestDialect, path: (typeof COLLECTION_PATHS)[number]) => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const run = (sql: string) => current!.adapter.executeQuery(sql);
    let id = "";

    /** A published, untranslated Draft/Published collection made in the Builder, in two languages. */
    async function seeded(): Promise<void> {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        collections: [],
      });
      const handler = current.getService("collectionsHandler") as unknown as {
        createCollection(
          data: Record<string, unknown>
        ): Promise<{ success: boolean }>;
      };
      const made = await handler.createCollection({
        name: "posts",
        label: "Post",
        status: true,
        fields: FIELDS,
      });
      expect(made.success, JSON.stringify(made)).toBe(true);
      const created = await current.nextly.create({
        collection: "posts",
        data: { heading: "Hello" },
      });
      id = (created.item as { id: string }).id;
      await current.nextly.update({
        collection: "posts",
        id,
        locale: "de",
        data: { heading: "Hallo", _overwrite: true },
      });
      await run(`UPDATE ${q("dc_posts")} SET ${q("status")} = 'published'`);
    }

    async function toggle(localized: boolean): Promise<unknown> {
      const [row] = await current!.adapter.executeQuery<{
        version: number | string | null;
      }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'posts'`
      );
      return path === "its schema dialog"
        ? dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields: FIELDS,
              confirmed: true,
              localized,
              schemaVersion: Number(row?.version ?? 1),
            }
          )
        : dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: "posts" },
            { localized }
          );
    }

    async function companionColumns(): Promise<string[]> {
      const snapshot = await introspectLiveSnapshot(
        current!.adapter.getDrizzle(),
        current!.adapter.dialect,
        ["dc_posts_locales"]
      );
      return (
        snapshot.tables[0]?.columns.map(column => column.name.toLowerCase()) ??
        []
      );
    }

    async function statesByLanguage(): Promise<Record<string, unknown>> {
      const rows = await current!.adapter.executeQuery<{
        locale: string;
        state: unknown;
      }>(
        `SELECT ${q("_locale")} AS locale, ${q("_status")} AS state FROM ${q("dc_posts_locales")}`
      );
      return Object.fromEntries(rows.map(row => [row.locale, row.state]));
    }

    async function headingIn(locale: string): Promise<unknown> {
      const read = await current!.nextly.findByID({
        collection: "posts",
        id,
        locale,
      } as never);
      return (read as { heading?: unknown }).heading;
    }

    it("gives every language the entry's publish state when translation is turned on, and moves no value", async () => {
      await seeded();
      expect(await companionColumns()).not.toContain("_status");

      await toggle(true);

      expect(await companionColumns()).toContain("_status");
      expect(await statesByLanguage()).toEqual({
        en: "published",
        de: "published",
      });
      expect(await headingIn("de")).toBe("Hallo");
      expect(await headingIn("en")).toBe("Hello");
    });

    it("refuses turning translation off while a language's publish state differs from the entry's", async () => {
      await seeded();
      await toggle(true);
      await run(
        `UPDATE ${q("dc_posts_locales")} SET ${q("_status")} = 'draft' WHERE ${q("_locale")} = 'de'`
      );

      const refused = await toggle(false).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(JSON.stringify(refused)).toContain(
        "1 entry has a language whose publish state differs from the entry's"
      );
      expect(await companionColumns()).toContain("_status");
    });

    it("drops the per-language states when translation is turned off and they agree, and moves no value", async () => {
      await seeded();
      await toggle(true);

      await toggle(false);

      expect(await companionColumns()).not.toContain("_status");
      expect(await headingIn("de")).toBe("Hallo");
      expect(await headingIn("en")).toBe("Hello");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a field group's Schema Builder dialog under per-language storage (%s)",
  (dialect: TestDialect) => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function columnsOf(table: string): Promise<string[]> {
      const snapshot = await introspectLiveSnapshot(
        current!.adapter.getDrizzle(),
        current!.adapter.dialect,
        [table]
      );
      return (
        snapshot.tables[0]?.columns.map(column => column.name.toLowerCase()) ??
        []
      );
    }

    async function apply(
      fields: { name: string; type: string }[],
      localized?: boolean
    ): Promise<unknown> {
      const [row] = await current!.adapter.executeQuery<{
        version: number | string | null;
      }>(
        `SELECT ${q("schema_version")} AS version FROM ${q("dynamic_components")} WHERE ${q("slug")} = 'badge'`
      );
      return dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "badge" },
        {
          fields,
          confirmed: true,
          ...(localized === undefined ? {} : { localized }),
          schemaVersion: Number(row?.version ?? 1),
        }
      );
    }

    // A field group that is not translated keeps its translatable values per language under the
    // setting, so a field its dialog adds, or a translation toggle, leaves them there.
    it("keeps an untranslated field group's translatable fields per language through its dialog", async () => {
      current = await createTestNextly({
        dialect,
        perLanguageStorage: true,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "badge", label: "Badge", fields: FIELDS }
      );

      const withSummary = [...FIELDS, { name: "summary", type: "text" }];
      await apply(withSummary);
      expect(await columnsOf("comp_badge_locales")).toEqual(
        expect.arrayContaining(["heading", "summary"])
      );
      expect(await columnsOf("comp_badge")).not.toContain("summary");

      await apply(withSummary, true);
      await apply(withSummary, false);
      expect(await columnsOf("comp_badge")).not.toContain("heading");
      expect(await columnsOf("comp_badge_locales")).toEqual(
        expect.arrayContaining(["heading", "summary"])
      );
    });
  }
);
