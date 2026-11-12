/**
 * The value an entry keeps when a field stops being translated, across the combinations that
 * decide it, on every dialect: which rows are live (published) or drafts, a language the site
 * removed, a field left blank (NULL or empty) in a row, and an entry with no default-language row.
 *
 * One expression chooses for every consumer: the copy and the Required and Unique checks read
 * `restoredValue`, the archive and the preview's counts read `chosenLocaleOf`. Both are asked here
 * of the same rows, and must agree with each other and with the table below.
 *
 * The rule: only rows a reader can reach count first (a language the site has, published), in the
 * reader's order (the default language, then the site's order), skipping a row where the field is
 * blank, as a reader is shown the next language that has it. A row no reader reaches (a draft, a
 * removed language) is taken only when no reachable row exists. So a published but blank row is
 * kept as blank rather than replaced by a draft no reader saw.
 *
 * The site's order stands in for each language's own configured fallback: the default language's
 * readers are the ones the shared value replaces, and the default falls back to no other language.
 */
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  chosenLocaleOf,
  copyLiveness,
  restoredValue,
} from "../migration/generate-down";

interface CollectionsHandler {
  createCollection(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
}

type Row = [
  locale: string,
  status: "published" | "draft",
  heading: string | null,
];

/** Each case: the entry's translation rows, and the language and value it keeps. */
const CASES: {
  name: string;
  rows: Row[];
  keeps: { locale: string | null; value: string | null };
}[] = [
  {
    name: "a published default row with a value",
    rows: [
      ["en", "published", "Hello"],
      ["de", "published", "Hallo"],
    ],
    keeps: { locale: "en", value: "Hello" },
  },
  {
    name: "a published default row that is blank, beside a published row with a value",
    rows: [
      ["en", "published", null],
      ["fr", "published", "Bonjour"],
    ],
    keeps: { locale: "fr", value: "Bonjour" },
  },
  {
    name: "a published default row that is empty text, beside a published row with a value",
    rows: [
      ["en", "published", ""],
      ["de", "published", "Hallo"],
    ],
    keeps: { locale: "de", value: "Hallo" },
  },
  {
    name: "a published default row that is blank, beside a draft with a value",
    rows: [
      ["en", "published", null],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "en", value: null },
  },
  {
    name: "every published row blank, beside a draft with a value",
    rows: [
      ["en", "published", null],
      ["fr", "published", ""],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "en", value: null },
  },
  {
    name: "no default row: a draft the site lists first, a published one after",
    rows: [
      ["de", "draft", "Hallo"],
      ["fr", "published", "Bonjour"],
    ],
    keeps: { locale: "fr", value: "Bonjour" },
  },
  {
    name: "no default row: two published rows, in the site's order rather than by code",
    rows: [
      ["fr", "published", "Bonjour"],
      ["de", "published", "Hallo"],
    ],
    keeps: { locale: "de", value: "Hallo" },
  },
  {
    name: "no default row and nothing published: the first draft in the site's order",
    rows: [
      ["fr", "draft", "Bonjour"],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "de", value: "Hallo" },
  },
  {
    name: "a draft default row and nothing published: the default's draft",
    rows: [
      ["en", "draft", "Hello"],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "en", value: "Hello" },
  },
  {
    name: "nothing published and the first draft blank: the next draft with a value",
    rows: [
      ["en", "draft", null],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "de", value: "Hallo" },
  },
  {
    name: "a removed language published, beside drafts of listed ones",
    rows: [
      ["it", "published", "Ciao"],
      ["de", "draft", "Hallo"],
    ],
    keeps: { locale: "de", value: "Hallo" },
  },
  {
    name: "a removed language published, beside a published blank default",
    rows: [
      ["en", "published", null],
      ["it", "published", "Ciao"],
    ],
    keeps: { locale: "en", value: null },
  },
  {
    name: "nothing published: a blank draft of a listed language over a removed language's value",
    rows: [
      ["en", "draft", null],
      ["it", "published", "Ciao"],
    ],
    keeps: { locale: "en", value: null },
  },
  {
    name: "only a removed language's row",
    rows: [["it", "published", "Ciao"]],
    keeps: { locale: "it", value: "Ciao" },
  },
  {
    name: "no translation rows at all",
    rows: [],
    keeps: { locale: null, value: null },
  },
];

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect("the value an entry keeps, case by case", dialect => {
  let current: TestNextly;
  const q = (name: string) => quote(dialect, name);
  const spec = {
    dialect,
    mainTable: "dc_posts",
    companionTable: "dc_posts_locales",
    defaultLocale: "en",
    liveness: copyLiveness(["en", "de", "fr"], true),
  } as const;

  beforeAll(async () => {
    // The builder creates the translations table in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({
      dialect,
      collections: [],
      localization: { locales: ["en", "de", "fr"], defaultLocale: "en" },
    });
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const made = await handler.createCollection({
      name: "posts",
      label: "Post",
      localized: true,
      status: true,
      fields: [{ name: "heading", type: "text" }],
    });
    expect(made.success, JSON.stringify(made)).toBe(true);
  });

  afterAll(async () => {
    await current?.destroy();
    vi.unstubAllEnvs();
  });

  it.each(CASES)("$name", async ({ rows, keeps }) => {
    const created = (await current.nextly.create({
      collection: "posts",
      locale: "en",
      data: { heading: "seed" },
    })) as { item: { id: string } };
    const id = created.item.id;
    await current.adapter.executeQuery(
      `DELETE FROM ${q("dc_posts_locales")} WHERE ${q("_parent")} = '${id}'`
    );
    for (const [locale, status, heading] of rows) {
      await current.adapter.executeQuery(
        `INSERT INTO ${q("dc_posts_locales")} (${q("_parent")}, ${q("_locale")}, ${q("_status")}, ${q("heading")}) ` +
          `VALUES ('${id}', '${locale}', '${status}', ${heading === null ? "NULL" : `'${heading}'`})`
      );
    }

    const [kept] = await current.adapter.executeQuery<{
      value: string | null;
      locale: string | null;
    }>(
      `SELECT ${restoredValue(spec, `${q("dc_posts_locales")}.${q("heading")}`)} AS ${q("value")}, ` +
        `${chosenLocaleOf(spec, `${q("dc_posts")}.${q("id")}`, "heading")} AS ${q("locale")} ` +
        `FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
    );

    expect({
      locale: kept?.locale ?? null,
      value: kept?.value ?? null,
    }).toEqual(keeps);
  });
});
