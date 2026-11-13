/**
 * The import, through Nextly's own request handler, on every configured
 * dialect, for pages with more than one version: a type keeping drafts,
 * whose published page and its working draft each get the values, an
 * editor's value in either kept; a translated type and a translated Single,
 * every language in one run; one report row per version; run again, nothing
 * changes; and a failure part-way through leaves every version as it was.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { group } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text, textarea } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { MANAGE_SEO_PERMISSION } from "../../permissions";
import { seoPlugin } from "../../plugin";
import { SEO_SETTINGS_SLUG } from "../../settings/contract";
import type { DryRunBody, ImportReportEntry, ImportSource } from "../contract";

/** The old SEO group each type keeps, translated where `localized` is set. */
function meta(localized: boolean) {
  return group({
    name: "meta",
    ...(localized ? { localized: true } : {}),
    fields: [text({ name: "seoTitle" }), textarea({ name: "seoDescription" })],
  });
}

const SOURCE: ImportSource = {
  kind: "group",
  field: "meta",
  map: { seoTitle: "title", seoDescription: "description" },
};

/** Which save of the run, counted from one, is made to fail, while one is. */
let failing: number | undefined;
/** How many saves of the watched types have run, while counted. */
let saves: number | undefined;

/** Counts each save, and fails the one `failing` names, once. */
function counted({ data }: { data?: unknown }) {
  if (saves !== undefined) {
    saves += 1;
    if (failing !== undefined && saves === failing) {
      failing = undefined;
      throw new Error("this save fails");
    }
  }
  return data;
}

let current: TestNextly | undefined;

afterEach(async () => {
  failing = undefined;
  saves = undefined;
  await current?.destroy();
  current = undefined;
});

const PLUGIN = ["plugins", "@nextlyhq", "plugin-seo"];

/** One request to a plugin route through core's handler, as `key`. */
async function call(
  key: string,
  route: string,
  body: unknown
): Promise<Response> {
  const segments = [...PLUGIN, ...route.split("/").filter(Boolean)];
  const request = new Request(
    `https://admin.example/api/${segments.join("/")}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  return createDynamicHandlers().POST(request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** A dry run of `source` (the old group), as `key`. */
async function dryRun(
  key: string,
  source: ImportSource = SOURCE
): Promise<DryRunBody> {
  const response = await call(key, "/import/dry-run", { source });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DryRunBody;
}

/** The apply of the dry run `plan` of `source` (the old group), as `key`. */
function apply(
  key: string,
  plan: string,
  source: ImportSource = SOURCE
): Promise<Response> {
  return call(key, "/import/apply", { source, plan });
}

/** A site, its content types each holding the old group. */
async function boot(
  dialect: TestDialect,
  options: { languages: boolean; domains?: boolean; titleUnread?: boolean }
): Promise<{ t: TestNextly; key: string }> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    // English on example.com and German on example.de, where asked.
    ...(options.domains === true
      ? {
          languageAddresses: {
            by: "domain" as const,
            domains: { en: "https://example.com", de: "https://example.de" },
          },
        }
      : {}),
    ...(options.languages
      ? {
          localization: {
            locales: [
              { code: "en", label: "English" },
              { code: "de", label: "Deutsch" },
            ],
            defaultLocale: "en",
          },
        }
      : {}),
    seedPublic: true,
    plugins: [
      seoPlugin(
        options.languages
          ? {
              collections: ["articles", "pages"],
              singles: ["home"],
              sitemap: false,
            }
          : {
              collections: ["notes"],
              singles: ["about"],
              sitemap: false,
              // A title the importer may write but never read, where asked.
              ...(options.titleUnread === true
                ? {
                    fields: [
                      text({
                        name: "metaTitle",
                        access: { read: () => false },
                      }),
                      textarea({ name: "metaDescription" }),
                    ],
                  }
                : {}),
            }
      ),
    ],
    collections: options.languages
      ? [
          // Translated, and keeping drafts in each language.
          defineCollection({
            slug: "articles",
            labels: { singular: "Article", plural: "Articles" },
            status: true,
            localized: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "slug" }),
              meta(true),
            ],
            publicAddress: "/articles/{slug}",
            hooks: { beforeChange: [counted] },
          }),
          // Translated, with no lifecycle.
          defineCollection({
            slug: "pages",
            labels: { singular: "Page", plural: "Pages" },
            localized: true,
            fields: [
              text({ name: "title", localized: true }),
              text({ name: "slug" }),
              meta(true),
            ],
            publicAddress: "/{slug}",
            hooks: { beforeChange: [counted] },
          }),
        ]
      : [
          defineCollection({
            slug: "notes",
            labels: { singular: "Note", plural: "Notes" },
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              text({ name: "slug" }),
              meta(false),
            ],
            publicAddress: "/notes/{slug}",
            hooks: { beforeChange: [counted] },
          }),
        ],
    singles: options.languages
      ? [
          defineSingle({
            slug: "home",
            label: { singular: "Home page" },
            localized: true,
            fields: [text({ name: "title", localized: true }), meta(true)],
            publicAddress: "/",
            hooks: { beforeChange: [counted] },
          }),
        ]
      : [
          // A Single keeping drafts, written outside the transaction.
          defineSingle({
            slug: "about",
            label: { singular: "About page" },
            status: true,
            versions: { drafts: true },
            fields: [text({ name: "title" }), meta(false)],
            publicAddress: "/about",
          }),
        ],
  });
  current = t;
  await t.nextly.updateSingle({
    slug: SEO_SETTINGS_SLUG,
    data: { _overwrite: true, siteName: "Nextly" },
  });
  const owner = await t.nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  const seeded = await t.nextly.permissions.find({ limit: 500 });
  const content = options.languages
    ? ["read-articles", "update-articles", "read-pages", "update-pages"]
    : ["read-notes", "update-notes"];
  const singles = options.languages
    ? ["read-home", "update-home"]
    : ["read-about", "update-about"];
  const ids = [...content, ...singles, MANAGE_SEO_PERMISSION].map(slug => {
    const found = seeded.items.find(item => item.slug === slug);
    if (found === undefined) throw new Error(`${slug} is not seeded`);
    return found.id;
  });
  // Changing content, and the site's SEO, but never publishing.
  const role = await t.nextly.roles.create({
    data: { name: "Importer", slug: "importer", permissionIds: ids },
  });
  const keys = t.getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ): Promise<{ key: string }>;
  };
  const { key } = await keys.createApiKey(String(owner.item.id), {
    name: "importer",
    tokenType: "role-based",
    roleId: String(role.item.id),
    expiresIn: "unlimited",
  });
  return { t, key };
}

/** A document's version as stored, read as the site. */
async function version(
  t: TestNextly,
  collection: string,
  id: string,
  options: { locale?: string; draft?: boolean } = {}
): Promise<Record<string, unknown>> {
  const read = await t.nextly.findByID({
    collection,
    id,
    status: "all",
    depth: 0,
    overrideAccess: true,
    // A language's own values, nothing filled in from another.
    ...(options.locale === undefined
      ? {}
      : { locale: options.locale, fallbackLocale: false }),
    ...(options.draft === true ? { draft: true } : {}),
  } as never);
  return read as unknown as Record<string, unknown>;
}

/** The Single's page in `locale`, as stored. */
async function home(
  t: TestNextly,
  locale: string
): Promise<Record<string, unknown>> {
  return (await t.nextly.findSingle({
    slug: "home",
    locale,
    status: "all",
    depth: 0,
    createIfMissing: false,
  } as never)) as unknown as Record<string, unknown>;
}

/**
 * The report's row for `label` in `version`, in `locale` where given: a row
 * naming no version or language is a page's one version, in the default
 * language.
 */
function rowOf(
  run: DryRunBody,
  label: string,
  form: "published" | "draft",
  locale?: string
): ImportReportEntry | undefined {
  return run.documents.find(
    entry =>
      entry.label === label &&
      (entry.version ?? "published") === form &&
      (locale === undefined || (entry.locale ?? "en") === locale)
  );
}

/** The title typed in a version's `seo` group: empty where none is. */
function typedTitle(document: Record<string, unknown>): string {
  const seo = document.seo as Record<string, unknown> | null | undefined;
  const title = seo?.metaTitle;
  return typeof title === "string" ? title : "";
}

/** A page created as the site, in `locale` where given; its id. */
async function create(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<string> {
  const created = await t.nextly.create({
    collection,
    data,
    ...(locale === undefined ? {} : { locale }),
  } as never);
  return String((created.item as { id: unknown }).id);
}

/** A save as the site, in `locale` where given. */
async function save(
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<void> {
  await t.nextly.update({
    collection,
    id,
    data: { ...data, _overwrite: true },
    ...(locale === undefined ? {} : { locale }),
  } as never);
}

describe.each(getConfiguredTestDialects())(
  "the SEO import, for every version of a page (%s)",
  dialect => {
    it("imports into a published page and its working draft, keeping an editor's draft value", async () => {
      const { t, key } = await boot(dialect, { languages: false });
      const pricing = await create(t, "notes", {
        title: "Pricing",
        slug: "pricing",
        status: "published",
        meta: { seoTitle: "Plans and prices", seoDescription: "What it costs" },
      });
      // A working draft, where an editor typed a description of their own.
      await save(t, "notes", pricing, {
        title: "Pricing (new)",
        seo: { metaDescription: "Typed in the draft" },
      });
      const roadmap = await create(t, "notes", {
        title: "Roadmap",
        slug: "roadmap",
        status: "published",
        meta: { seoTitle: "What comes next" },
      });
      // Never published.
      const ideas = await create(t, "notes", {
        title: "Ideas",
        slug: "ideas",
        meta: { seoTitle: "Ideas we have" },
      });

      const run = await dryRun(key);
      expect(rowOf(run, "Pricing", "published")).toMatchObject({
        outcome: "set",
        set: ["title", "description"],
      });
      // The draft is named as it is now.
      expect(rowOf(run, "Pricing (new)", "draft")).toMatchObject({
        outcome: "set",
        set: ["title"],
        kept: ["description"],
      });
      expect(rowOf(run, "Roadmap", "published")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });
      expect(rowOf(run, "Roadmap", "draft")).toBeUndefined();
      expect(rowOf(run, "Ideas", "draft")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });
      expect(run.pages).toBe(3);
      // Nothing changes until applied.
      expect(typedTitle(await version(t, "notes", pricing))).toBe("");

      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);

      const live = await version(t, "notes", pricing);
      expect(live).toMatchObject({ title: "Pricing", status: "published" });
      expect(live.seo).toMatchObject({
        metaTitle: "Plans and prices",
        metaDescription: "What it costs",
      });
      const draft = await version(t, "notes", pricing, { draft: true });
      // Still a draft waiting to be published, with the editor's value.
      expect(draft).toMatchObject({
        title: "Pricing (new)",
        _isWorkingDraft: true,
      });
      expect(draft.seo).toMatchObject({
        metaTitle: "Plans and prices",
        metaDescription: "Typed in the draft",
      });
      expect((await version(t, "notes", roadmap)).seo).toMatchObject({
        metaTitle: "What comes next",
      });
      // No draft was made for a page that had none.
      expect(
        (await version(t, "notes", roadmap, { draft: true }))._isWorkingDraft
      ).not.toBe(true);
      const unpublished = await version(t, "notes", ideas);
      expect(unpublished.status).toBe("draft");
      expect(unpublished.seo).toMatchObject({ metaTitle: "Ideas we have" });

      // Run again, every place is filled: nothing to set, nothing changes.
      const again = await dryRun(key);
      expect(again.pages).toBe(0);
      expect(again.documents.filter(entry => entry.set.length > 0)).toEqual([]);
      const reapplied = await apply(key, again.plan);
      expect(reapplied.status, await reapplied.clone().text()).toBe(200);
      expect(
        (await version(t, "notes", pricing, { draft: true })).seo
      ).toMatchObject({
        metaTitle: "Plans and prices",
        metaDescription: "Typed in the draft",
      });
    });

    it("imports into a draft a title the importer may write but not read", async () => {
      const { t, key } = await boot(dialect, {
        languages: false,
        titleUnread: true,
      });
      const pricing = await create(t, "notes", {
        title: "Pricing",
        slug: "pricing",
        status: "published",
        meta: { seoTitle: "Plans and prices" },
      });
      await save(t, "notes", pricing, { title: "Pricing (new)" });

      const run = await dryRun(key);
      expect(rowOf(run, "Pricing (new)", "draft")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });
      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);
      // Read as the site, which may read it.
      expect(
        typedTitle(await version(t, "notes", pricing, { draft: true }))
      ).toBe("Plans and prices");
    });

    it("leaves a published Single to its waiting draft, which gets the values and stays a draft", async () => {
      const { t, key } = await boot(dialect, { languages: false });
      await t.nextly.updateSingle({
        slug: "about",
        data: {
          _overwrite: true,
          title: "About",
          status: "published",
          meta: { seoTitle: "Who we are" },
        },
      } as never);
      await t.nextly.updateSingle({
        slug: "about",
        data: { _overwrite: true, title: "About (new)" },
      } as never);

      const run = await dryRun(key);
      expect(rowOf(run, "About", "published")).toMatchObject({
        outcome: "skipped",
        set: [],
        withDraft: ["title"],
      });
      expect(rowOf(run, "About (new)", "draft")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });

      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);
      const read = (draft: boolean) =>
        t.nextly.findSingle({
          slug: "about",
          status: "all",
          depth: 0,
          createIfMissing: false,
          ...(draft ? { draft: true } : {}),
        } as never) as unknown as Promise<Record<string, unknown>>;
      // What is published is as it was; the draft holds the value, waiting.
      const live = await read(false);
      expect(live.title).toBe("About");
      expect(typedTitle(live)).toBe("");
      const draft = await read(true);
      expect(draft).toMatchObject({
        title: "About (new)",
        _isWorkingDraft: true,
      });
      expect(typedTitle(draft)).toBe("Who we are");
    });

    it("imports every language of a translated type and Single in one run", async () => {
      const { t, key } = await boot(dialect, { languages: true });
      const about = await create(
        t,
        "pages",
        { title: "About", slug: "about", meta: { seoTitle: "About us" } },
        "en"
      );
      await save(
        t,
        "pages",
        about,
        {
          title: "Über uns",
          meta: { seoTitle: "Wer wir sind", seoDescription: "Das Team" },
        },
        "de"
      );
      await t.nextly.updateSingle({
        slug: "home",
        locale: "en",
        data: {
          _overwrite: true,
          title: "Home",
          meta: { seoTitle: "Welcome" },
        },
      } as never);
      await t.nextly.updateSingle({
        slug: "home",
        locale: "de",
        data: {
          _overwrite: true,
          title: "Start",
          meta: { seoTitle: "Willkommen" },
        },
      } as never);

      const run = await dryRun(key);
      expect(rowOf(run, "About", "published", "en")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });
      expect(rowOf(run, "Über uns", "published", "de")).toMatchObject({
        outcome: "set",
        set: ["title", "description"],
        values: { title: "Wer wir sind", description: "Das Team" },
      });
      expect(rowOf(run, "Home", "published", "en")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });
      expect(rowOf(run, "Start", "published", "de")).toMatchObject({
        outcome: "set",
        set: ["title"],
      });

      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);
      expect(
        (await version(t, "pages", about, { locale: "en" })).seo
      ).toMatchObject({ metaTitle: "About us" });
      expect(
        (await version(t, "pages", about, { locale: "de" })).seo
      ).toMatchObject({
        metaTitle: "Wer wir sind",
        metaDescription: "Das Team",
      });
      expect((await home(t, "en")).seo).toMatchObject({ metaTitle: "Welcome" });
      expect((await home(t, "de")).seo).toMatchObject({
        metaTitle: "Willkommen",
      });

      const again = await dryRun(key);
      expect(again.pages).toBe(0);
    });

    it("gives each language and draft of a page its own row, as the board shows", async () => {
      const { t, key } = await boot(dialect, { languages: true });
      const pricing = await create(
        t,
        "articles",
        {
          title: "Pricing",
          slug: "pricing",
          status: "published",
          meta: { seoTitle: "Plans", seoDescription: "What it costs" },
        },
        "en"
      );
      await save(
        t,
        "articles",
        pricing,
        {
          title: "Preise",
          status: "published",
          meta: { seoDescription: "Was es kostet" },
        },
        "de"
      );
      // An English draft with a description of an editor's own.
      await save(
        t,
        "articles",
        pricing,
        {
          title: "Pricing (new)",
          seo: { metaDescription: "Typed in the draft" },
        },
        "en"
      );

      const run = await dryRun(key);
      expect(rowOf(run, "Pricing", "published", "en")).toMatchObject({
        outcome: "set",
        set: ["title", "description"],
      });
      expect(rowOf(run, "Pricing (new)", "draft", "en")).toMatchObject({
        set: ["title"],
        kept: ["description"],
      });
      expect(rowOf(run, "Preise", "published", "de")).toMatchObject({
        set: ["description"],
      });
      expect(run.documents.filter(entry => entry.id === pricing).length).toBe(
        3
      );

      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);
      expect(
        (await version(t, "articles", pricing, { locale: "en" })).seo
      ).toMatchObject({ metaTitle: "Plans", metaDescription: "What it costs" });
      expect(
        (await version(t, "articles", pricing, { locale: "en", draft: true }))
          .seo
      ).toMatchObject({
        metaTitle: "Plans",
        metaDescription: "Typed in the draft",
      });
      expect(
        (await version(t, "articles", pricing, { locale: "de" })).seo
      ).toMatchObject({ metaDescription: "Was es kostet" });
      expect(
        (await version(t, "articles", pricing, { locale: "en", draft: true }))
          .title
      ).toBe("Pricing (new)");
    });

    it("leaves a page in another language with a waiting draft as it is, and never publishes the draft", async () => {
      const { t, key } = await boot(dialect, { languages: true });
      const roadmap = await create(
        t,
        "articles",
        { title: "Roadmap", slug: "roadmap", status: "published" },
        "en"
      );
      await save(
        t,
        "articles",
        roadmap,
        {
          title: "Fahrplan",
          status: "published",
          meta: { seoTitle: "Was als Nächstes kommt" },
        },
        "de"
      );
      // A German draft waits beside the published German page.
      await save(t, "articles", roadmap, { title: "Fahrplan (neu)" }, "de");

      const run = await dryRun(key);
      // Neither is written: the published one would publish the draft, and
      // a draft in another language keeps no imported group.
      expect(rowOf(run, "Fahrplan", "published", "de")).toMatchObject({
        outcome: "skipped",
        set: [],
        waiting: ["title"],
      });
      expect(rowOf(run, "Fahrplan (neu)", "draft", "de")).toMatchObject({
        outcome: "skipped",
        set: [],
        waiting: ["title"],
      });
      expect(run.warnings.join(" ")).toContain("Fahrplan");

      const applied = await apply(key, run.plan);
      expect(applied.status, await applied.clone().text()).toBe(200);
      const live = await version(t, "articles", roadmap, { locale: "de" });
      // The published page is as it was: the draft was not published.
      expect(live.title).toBe("Fahrplan");
      expect(typedTitle(live)).toBe("");
      const draft = await version(t, "articles", roadmap, {
        locale: "de",
        draft: true,
      });
      expect(draft).toMatchObject({
        title: "Fahrplan (neu)",
        _isWorkingDraft: true,
      });
      expect(typedTitle(draft)).toBe("");
    });

    it("matches a file's address on a language's own domain to that language", async () => {
      const { t, key } = await boot(dialect, {
        languages: true,
        domains: true,
      });
      const about = await create(
        t,
        "pages",
        { title: "About", slug: "about" },
        "en"
      );
      await save(t, "pages", about, { title: "Über uns" }, "de");
      const source: ImportSource = {
        kind: "rankMath",
        fileName: "rank-math.csv",
        text: [
          "id,url,seo_title",
          "1,https://example.com/about,About the team",
          "2,https://example.de/about,Über das Team",
          // The old site's address, read by its path: the default language.
          "3,https://old.example/about/,Old about",
        ].join("\n"),
      };

      const run = await dryRun(key, source);
      expect(rowOf(run, "About", "published", "en")).toMatchObject({
        outcome: "set",
        set: ["title"],
        values: { title: "About the team" },
      });
      expect(rowOf(run, "Über uns", "published", "de")).toMatchObject({
        outcome: "set",
        set: ["title"],
        values: { title: "Über das Team" },
      });
      // The third names a page already matched: the first is used.
      expect(
        run.documents.filter(
          entry => entry.reason === "Named more than once; the first is used."
        )
      ).toMatchObject([{ label: "/about", outcome: "skipped" }]);

      const applied = await apply(key, run.plan, source);
      expect(applied.status, await applied.clone().text()).toBe(200);
      expect(
        typedTitle(await version(t, "pages", about, { locale: "en" }))
      ).toBe("About the team");
      expect(
        typedTitle(await version(t, "pages", about, { locale: "de" }))
      ).toBe("Über das Team");
    });

    it("leaves every version as it was when a save fails part-way", async () => {
      const { t, key } = await boot(dialect, { languages: true });
      const about = await create(
        t,
        "pages",
        { title: "About", slug: "about", meta: { seoTitle: "About us" } },
        "en"
      );
      await save(
        t,
        "pages",
        about,
        { title: "Über uns", meta: { seoTitle: "Wer wir sind" } },
        "de"
      );
      const pricing = await create(
        t,
        "articles",
        {
          title: "Pricing",
          slug: "pricing",
          status: "published",
          meta: { seoTitle: "Plans" },
        },
        "en"
      );
      await save(t, "articles", pricing, { title: "Pricing (new)" }, "en");
      await t.nextly.updateSingle({
        slug: "home",
        locale: "de",
        data: {
          _overwrite: true,
          title: "Start",
          meta: { seoTitle: "Willkommen" },
        },
      } as never);

      const run = await dryRun(key);
      const writes = run.documents.filter(entry => entry.set.length > 0).length;
      expect(writes).toBe(5);
      // Whichever save comes last fails: every one before it is undone.
      saves = 0;
      failing = writes;
      const refused = await apply(key, run.plan);
      expect(refused.status).not.toBe(200);
      failing = undefined;
      saves = undefined;

      for (const locale of ["en", "de"]) {
        expect(typedTitle(await version(t, "pages", about, { locale }))).toBe(
          ""
        );
      }
      expect(
        typedTitle(await version(t, "articles", pricing, { locale: "en" }))
      ).toBe("");
      expect(
        typedTitle(
          await version(t, "articles", pricing, { locale: "en", draft: true })
        )
      ).toBe("");
      expect(typedTitle(await home(t, "de"))).toBe("");

      // Every place is empty again, so a dry run offers every write again.
      const after = await dryRun(key);
      const wanted = (each: DryRunBody) =>
        each.documents
          .filter(entry => entry.set.length > 0)
          .map(entry => [entry.label, entry.locale, entry.version, entry.set]);
      expect(wanted(after)).toEqual(wanted(run));
    });
  }
);
