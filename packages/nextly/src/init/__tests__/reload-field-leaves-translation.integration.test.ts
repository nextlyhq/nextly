// A config reload under `next dev` that makes a field of a translated collection shared keeps the
// field's values: the default language's on the main table, every other language in the archive.
// Driven through `reloadNextlyConfig` itself, on every configured dialect.
//
// A Required or Unique field leaving translation is added to the main table without its setting,
// filled from the default language, and given the setting before its translations column goes. When
// the values cannot take the setting, the reload changes nothing and says why.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../config";
import { CollectionRegistryService } from "../../domains/collections/services/collection-registry-service";
import {
  publishDeclaredEntities,
  restoreDeclaredEntities,
} from "../../domains/dynamic-collections/services/removed-from-code-writes";
import type { PromptDispatcher } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { reloadNextlyConfig } from "../reload-config";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

/**
 * Which ask of the Required and Unique preconditions rejects, counted from 1 within a test (0 for
 * none): the first is before the apply, the second the re-check after the copy.
 */
const preconditions = vi.hoisted(() => ({ failing: 0, asked: 0 }));
vi.mock(
  "../../domains/i18n/migration/leaving-constraint-preconditions",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../domains/i18n/migration/leaving-constraint-preconditions")
      >();
    return {
      ...actual,
      refusalsForConstrainedFieldsLeaving: (
        ...args: Parameters<typeof actual.refusalsForConstrainedFieldsLeaving>
      ) => {
        preconditions.asked += 1;
        return preconditions.asked === preconditions.failing
          ? Promise.reject(new Error("connection reset"))
          : actual.refusalsForConstrainedFieldsLeaving(...args);
      },
    };
  }
);

const SLUG = "rlleaves";
const TABLE = `dc_${SLUG}`;
const COMPANION = `${TABLE}_locales`;
/** A second collection, for a reload that moves fields of two at once. */
const OTHER = "rlleavesb";
const OTHER_TABLE = `dc_${OTHER}`;

/** The collection, translated, with `body` translated or shared and its settings. */
type Body = {
  localized: boolean;
  required?: boolean;
  unique?: boolean;
  type?: string;
  /** A shared field beside it, for a reload that changes something else too. */
  summary?: true;
  /** `title`'s type, for a reload with a change that needs review. */
  titleType?: string;
  /** A unique index on `body` declared in the collection's `indexes`. */
  indexedUnique?: true;
  /** A unique index on `body` and `title` together declared in the collection's `indexes`. */
  pairUnique?: true;
  /** `body` declared under this name instead, as a rename in the config. */
  renamedTo?: string;
  /** The collection is Draft/Published, so each language publishes on its own. */
  status?: true;
};

/** A translated collection whose `body` is translated or shared, with its settings. */
const collectionWith = (
  slug: string,
  {
    summary,
    titleType,
    indexedUnique,
    pairUnique,
    renamedTo,
    status,
    ...body
  }: Body
) =>
  defineCollection({
    slug,
    localized: true,
    ...(status ? { status: true } : {}),
    ...(indexedUnique ? { indexes: [{ fields: ["body"], unique: true }] } : {}),
    ...(pairUnique
      ? { indexes: [{ fields: ["body", "title"], unique: true }] }
      : {}),
    fields: [
      { name: "title", type: titleType ?? "text", localized: false },
      { name: renamedTo ?? "body", type: "text", ...body },
      ...(summary ? [{ name: "summary", type: "text", localized: false }] : []),
    ] as never,
  });

/** The collection, and `other` beside it when given. */
const configWith = (body: Body, other?: Body) =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      collectionWith(SLUG, body),
      ...(other ? [collectionWith(OTHER, other)] : []),
    ],
  });

describe.each(getConfiguredTestDialects())(
  "a config reload that makes a translated field shared (%s)",
  dialect => {
    let handle: TestNextly;
    let said: ReturnType<typeof vi.spyOn>[];

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      preconditions.failing = 0;
      preconditions.asked = 0;
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The reload runs its schema work only under next dev.
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configWith({ localized: true });
      await reloadNextlyConfig();
      said = [
        vi.spyOn(console, "warn").mockImplementation(() => {}),
        vi.spyOn(console, "error").mockImplementation(() => {}),
      ];
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    /** Entries with their values of `body` by language; a language left out has no row. */
    async function seed(
      entries: Record<string, { en?: string; es?: string }>,
      table = TABLE
    ): Promise<void> {
      for (const [id, values] of Object.entries(entries)) {
        await handle.adapter.executeQuery(
          `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('${id}', '${id}', '${id}')`
        );
        for (const [locale, value] of Object.entries(values)) {
          await handle.adapter.executeQuery(
            `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('${id}', '${locale}', '${value}')`
          );
        }
      }
    }

    async function columnsOf(name: string): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        dialect === "sqlite"
          ? `SELECT name AS name FROM pragma_table_info('${name}')`
          : dialect === "mysql"
            ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${name}'`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${name}'`
      )) as { name: string }[];
      return rows.map(row => row.name);
    }

    async function mainBodies(
      table = TABLE
    ): Promise<Record<string, string | null>> {
      const rows = (await handle.adapter.executeQuery(
        `SELECT ${q("id")} AS id, ${q("body")} AS body FROM ${q(table)} ORDER BY ${q("id")}`
      )) as { id: string; body: string | null }[];
      return Object.fromEntries(rows.map(row => [row.id, row.body]));
    }

    async function archived(): Promise<{ locale: string; value: string }[]> {
      return (await handle.adapter.executeQuery(
        `SELECT ${q("locale")} AS locale, ${q("value")} AS value FROM ${q("nextly_i18n_archive")} ` +
          `WHERE ${q("collection")} = '${SLUG}' AND ${q("field")} = 'body' ORDER BY ${q("id")}`
      )) as { locale: string; value: string }[];
    }

    const told = () =>
      said.flatMap(spy => spy.mock.calls.flat().map(String)).join("\n");

    /** The collections the write guard judges by, which a reload that does not land puts back. */
    function declaredCollections(): string[] {
      const now = publishDeclaredEntities(undefined);
      restoreDeclaredEntities(now);
      return [...(now?.collections ?? [])];
    }

    it("stops the reload when the registry can't be read, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });
      vi.spyOn(
        CollectionRegistryService.prototype,
        "getAllTranslationShapes"
      ).mockRejectedValueOnce(new Error("connection reset"));

      // A second collection too, which the abandoned reload must not leave declared.
      loaded.config = configWith({ localized: false }, { localized: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/registry could not be read/);
      expect(told()).toMatch(/No code-first schema changes were applied/);
      expect(declaredCollections()).not.toContain(OTHER);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("stops the reload when a read before the apply fails, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });
      preconditions.failing = 1;

      loaded.config = configWith({ localized: false }, { localized: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/connection reset.*No code-first schema changes/s);
      expect(declaredCollections()).not.toContain(OTHER);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    // A write the still-installed translated handlers make between the final copy and the drop
    // would land in a column about to go. On PostgreSQL the drops hold the translations table
    // against writes, so such a write waits and then fails; it is never taken and then lost.
    it.skipIf(dialect !== "postgresql")(
      "never loses a write made between the final copy and the drop",
      async () => {
        await seed({ e1: { en: "Hello", es: "Hola" } });
        // The late write is another request's: started here, in this test's own flow and outside
        // the reload's transaction, on another connection. It waits for the final copy, and the
        // reload's transaction only says when that is; a write it started itself would be the
        // transaction's own flow writing past it.
        const late: { signalled?: boolean } = {};
        let copied: () => void = () => {};
        const write = new Promise<void>(resolve => {
          copied = resolve;
        })
          .then(() =>
            handle.adapter.executeQuery(
              `UPDATE ${q(COMPANION)} SET ${q("body")} = 'Late' WHERE ${q("_parent")} = 'e1' AND ${q("_locale")} = 'en'`
            )
          )
          .then(
            () => "taken",
            () => "refused"
          );
        const textOf = (query: unknown) =>
          JSON.stringify(
            (query as { queryChunks?: unknown }).queryChunks ?? ""
          );
        const drizzle = handle.adapter.getDrizzle.bind(handle.adapter);
        vi.spyOn(handle.adapter, "getDrizzle").mockImplementation(() => {
          const db = drizzle() as {
            transaction(run: (tx: unknown) => Promise<void>): Promise<void>;
          };
          return new Proxy(db, {
            get(target, key, receiver) {
              if (key !== "transaction")
                return Reflect.get(target, key, receiver);
              return (run: (tx: unknown) => Promise<void>) =>
                target.transaction(tx =>
                  run(
                    new Proxy(tx as object, {
                      get(t, k, r) {
                        if (k !== "execute") return Reflect.get(t, k, r);
                        return async (query: unknown) => {
                          const done = await (
                            t as { execute(q: unknown): Promise<unknown> }
                          ).execute(query);
                          const text = textOf(query);
                          // Right after the final copy onto main, from another connection.
                          if (
                            late.signalled !== true &&
                            text.includes(`UPDATE \\"${TABLE}\\"`) &&
                            text.includes(COMPANION)
                          ) {
                            late.signalled = true;
                            copied();
                            await new Promise(resolve =>
                              setTimeout(resolve, 300)
                            );
                          }
                          return done;
                        };
                      },
                    })
                  )
                );
            },
          }) as ReturnType<typeof drizzle>;
        });

        loaded.config = configWith({ localized: false });
        await reloadNextlyConfig();

        expect(late.signalled).toBe(true);
        const outcome = await write;
        expect(await columnsOf(COMPANION)).not.toContain("body");
        expect(await mainBodies()).toEqual({
          e1: outcome === "taken" ? "Late" : "Hello",
        });
        expect(outcome).toBe("refused");
      }
    );

    it("stops the move when the re-check after the copy fails, keeping the translations column", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });
      preconditions.failing = 2;

      loaded.config = configWith({ localized: false });
      await reloadNextlyConfig();

      expect(told()).toMatch(/"rlleaves" were not moved: connection reset/);
      expect(told()).toMatch(/Translation stays on for rlleaves/);
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("keeps the default language's value on the main table, and archives the others", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      loaded.config = configWith({ localized: false });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await archived()).toEqual([{ locale: "es", value: "Hola" }]);
      expect(await columnsOf(COMPANION)).not.toContain("body");
    });

    it("makes a Required field required once its values are copied, without asking", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" }, e2: { en: "Bye" } });

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello", e2: "Bye" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      // NOT NULL, with no default to fill it.
      await expect(
        handle.adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e3', 'e3', 'e3')`
        )
      ).rejects.toThrow();
    });

    // An entry with a value in another language keeps that one, so only an entry with none in
    // any language is left without a value.
    it("refuses a Required field while an entry has no value in any language, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" }, e2: {} });

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      // The refusal of the setting, not the terminal prompt for a required column.
      expect(told()).toMatch(/would have no body once it is shared/);
      expect(told()).toMatch(/remove `required`.*save/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    // Each language publishes on its own: an English draft is not what readers saw, so the
    // published Spanish is the value kept, as the Schema Builder's save keeps it.
    it("keeps the published Spanish over an English draft of a Draft/Published collection", async () => {
      loaded.config = configWith(
        { localized: true },
        { localized: true, status: true }
      );
      await reloadNextlyConfig();
      const companionOf = `${OTHER_TABLE}_locales`;
      expect(await columnsOf(companionOf)).toContain("_status");
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(OTHER_TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("status")}) VALUES ('d1', 'd1', 'd1', 'published')`
      );
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(companionOf)} (${q("_parent")}, ${q("_locale")}, ${q("_status")}, ${q("body")}) VALUES ('d1', 'en', 'draft', 'Draft'), ('d1', 'es', 'published', 'Hola')`
      );

      loaded.config = configWith(
        { localized: true },
        { localized: false, status: true }
      );
      await reloadNextlyConfig();

      const [main] = await handle.adapter.executeQuery<{
        body: string | null;
      }>(
        `SELECT ${q("body")} AS body FROM ${q(OTHER_TABLE)} WHERE ${q("id")} = 'd1'`
      );
      expect(main?.body).toBe("Hola");
    });

    it("makes a Unique field unique once its values are copied", async () => {
      await seed({ e1: { en: "A", es: "Uno" }, e2: { en: "B", es: "Uno" } });

      loaded.config = configWith({ localized: false, unique: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "A", e2: "B" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      await expect(
        handle.adapter.executeQuery(
          `UPDATE ${q(TABLE)} SET ${q("body")} = 'A' WHERE ${q("id")} = 'e2'`
        )
      ).rejects.toThrow();
    });

    it("moves Required fields of two collections in one reload, each required once its values are copied", async () => {
      loaded.config = configWith({ localized: true }, { localized: true });
      await reloadNextlyConfig();
      await seed({ e1: { en: "Hello", es: "Hola" } });
      await seed({ f1: { en: "Bye", es: "Adiós" } }, OTHER_TABLE);

      loaded.config = configWith(
        { localized: false, required: true },
        { localized: false, required: true }
      );
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await mainBodies(OTHER_TABLE)).toEqual({ f1: "Bye" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      expect(await columnsOf(`${OTHER_TABLE}_locales`)).not.toContain("body");
    });

    it("leaves a translations column the registry never recorded as the field's, and the main value", async () => {
      // The field has been shared since the last reload; a column of the same name is left in the
      // translations table, from before.
      loaded.config = configWith({ localized: false });
      await reloadNextlyConfig();
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("body")}) VALUES ('e1', 'e1', 'e1', 'Fresh')`
      );
      await handle.adapter.executeQuery(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("body")} TEXT`
      );
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(COMPANION)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('e1', 'en', 'Stale')`
      );

      // A reload that changes something else, so it applies and reaches the move.
      loaded.config = configWith({ localized: false, summary: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Fresh" });
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("refuses a field that changes how it is stored as it leaves translation, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      loaded.config = configWith({ localized: false, type: "number" });
      await reloadNextlyConfig();

      expect(told()).toMatch(/"rlleaves".*body/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    it("finishes a move an earlier reload stopped after adding the main column", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });
      // What the first apply of a stopped move leaves: the main column, nullable and empty, of the
      // type a code-first text field has (bounded on MySQL).
      await handle.adapter.executeQuery(
        `ALTER TABLE ${q(TABLE)} ADD COLUMN ${q("body")} ${dialect === "mysql" ? "VARCHAR(255)" : "TEXT"}`
      );

      loaded.config = configWith({ localized: false, required: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Hello" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
    });

    it("stops the reload when the collection a field leaves translation on has a change that needs review", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      // `title` changes type, which a reload leaves for review: the field's move waits for it,
      // even where the terminal confirms the type change, as a developer at one may.
      const confirming: PromptDispatcher = {
        dispatch: () =>
          Promise.resolve({
            confirmedRenames: [],
            resolutions: [],
            proceed: true,
          }),
      };
      loaded.config = configWith({ localized: false, titleType: "number" });
      await reloadNextlyConfig({ dispatcher: confirming });

      expect(told()).toMatch(/"rlleaves".*another change/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    it("refuses a field an index makes unique while two entries share an English value, changing nothing", async () => {
      await seed({ e1: { en: "Same", es: "Uno" }, e2: { en: "Same" } });

      loaded.config = configWith({ localized: false, indexedUnique: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/would share a value for body/);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
    });

    it("makes a field an index makes unique unique once its values are copied", async () => {
      await seed({ e1: { en: "A", es: "Uno" }, e2: { en: "B", es: "Uno" } });

      loaded.config = configWith({ localized: false, indexedUnique: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "A", e2: "B" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      await expect(
        handle.adapter.executeQuery(
          `UPDATE ${q(TABLE)} SET ${q("body")} = 'A' WHERE ${q("id")} = 'e2'`
        )
      ).rejects.toThrow();
    });

    // The index holds `body` and `title` together, so English values that repeat under different
    // titles are what it allows: only the pair is unique.
    it("moves a field a two-column unique index covers while its English values repeat under different titles", async () => {
      await seed({ e1: { en: "Same", es: "Uno" }, e2: { en: "Same" } });

      loaded.config = configWith({ localized: false, pairUnique: true });
      await reloadNextlyConfig();

      expect(await mainBodies()).toEqual({ e1: "Same", e2: "Same" });
      expect(await columnsOf(COMPANION)).not.toContain("body");
      // The pair is unique once the values are copied.
      await expect(
        handle.adapter.executeQuery(
          `UPDATE ${q(TABLE)} SET ${q("title")} = 'e1' WHERE ${q("id")} = 'e2'`
        )
      ).rejects.toThrow();
    });

    // Renamed and made shared in one edit, the field's values would stay in a translations column
    // nothing reads: the reload stops and says to make the two changes one at a time.
    it("refuses a field renamed and made shared in one edit, changing nothing", async () => {
      await seed({ e1: { en: "Hello", es: "Hola" } });

      loaded.config = configWith({ localized: false, renamedTo: "content" });
      await reloadNextlyConfig();

      expect(told()).toMatch(
        /"rlleaves".*body.*content.*Rename the field first, then mark it shared, in two reloads/s
      );
      expect(await columnsOf(TABLE)).not.toContain("content");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });

    // A rename the main table's rule can't pair, because another field is added beside it or the
    // type changes too, still leaves the old translated name gone while new shared names appear.
    it.each([
      {
        edit: "another shared field added in the same edit",
        body: { localized: false, renamedTo: "content", summary: true } as Body,
      },
      {
        edit: "its type changed in the same edit",
        body: {
          localized: false,
          renamedTo: "content",
          type: "number",
        } as Body,
      },
    ])(
      "refuses a translated field gone while shared fields appear, with $edit, changing nothing",
      async ({ body }) => {
        await seed({ e1: { en: "Hello", es: "Hola" } });

        loaded.config = configWith(body);
        await reloadNextlyConfig();

        expect(told()).toMatch(
          /"rlleaves".*body.*content.*Rename the field first, then mark it shared, in two reloads/s
        );
        expect(await columnsOf(TABLE)).not.toContain("content");
        expect(await columnsOf(COMPANION)).toContain("body");
        expect(await archived()).toEqual([]);
      }
    );

    it("refuses a Unique field while two entries share an English value, changing nothing", async () => {
      await seed({ e1: { en: "Same", es: "Uno" }, e2: { en: "Same" } });

      loaded.config = configWith({ localized: false, unique: true });
      await reloadNextlyConfig();

      expect(told()).toMatch(/would share a value for body/);
      expect(told()).toMatch(/remove `unique`.*save/s);
      expect(await columnsOf(TABLE)).not.toContain("body");
      expect(await columnsOf(COMPANION)).toContain("body");
      expect(await archived()).toEqual([]);
    });
  }
);

// Under `experimental.perLanguageStorage` a collection that is not translated keeps its
// translatable fields per language too, so a field made shared leaves its per-language table on a
// reload as a translated collection's does: its default language's value moves to the main table.
describe.each(getConfiguredTestDialects())(
  "a config reload that makes a field shared under per-language storage (%s)",
  dialect => {
    const slug = "rlleavesps";
    const table = `dc_${slug}`;
    let handle: TestNextly;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The collection, not marked translatable, with `body` translatable or shared. */
    const config = (bodyShared: boolean) =>
      defineConfig({
        experimental: { perLanguageStorage: true },
        localization: { locales: ["en", "es"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug,
            fields: [
              { name: "title", type: "text", localized: false },
              {
                name: "body",
                type: "text",
                ...(bodyShared ? { localized: false } : {}),
              },
            ] as never,
          }),
        ],
      });

    beforeEach(async () => {
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        perLanguageStorage: true,
      });
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = config(false);
      await reloadNextlyConfig();
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await handle?.destroy();
    });

    it("moves the default language's value to the main table", async () => {
      await handle.adapter.executeQuery(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}) VALUES ('e1', 'e1', 'e1')`
      );
      for (const [locale, value] of [
        ["en", "Hello"],
        ["es", "Hola"],
      ]) {
        await handle.adapter.executeQuery(
          `INSERT INTO ${q(`${table}_locales`)} (${q("_parent")}, ${q("_locale")}, ${q("body")}) VALUES ('e1', '${locale}', '${value}')`
        );
      }

      loaded.config = config(true);
      await reloadNextlyConfig();

      const rows = await handle.adapter.executeQuery<{ body: string | null }>(
        `SELECT ${q("body")} AS body FROM ${q(table)} WHERE ${q("id")} = 'e1'`
      );
      expect(rows).toEqual([{ body: "Hello" }]);
    });
  }
);
