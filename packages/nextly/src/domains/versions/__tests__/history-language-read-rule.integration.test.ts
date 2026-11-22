/**
 * The languages of a document's history a caller may read are the languages
 * the collection's or Single's own read rule admits for that caller: history
 * in a language the rule refuses is not readable, as the document in that
 * language is not. The same holds for the history route itself, and for a
 * discard, which hands back the document in the language it discards.
 */
// Set before the harness boots: signing API keys reads it once.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  superAdminUser,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { GET as listRoute } from "../../../api/versions";
import {
  assertVersionDocumentReadable,
  readableHistoryLocales,
} from "../../../api/versions-access";
import { GET as detailRoute } from "../../../api/versions-detail";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  asCaller,
  sessionCaller,
} from "../../../dispatcher/__tests__/request-caller";
import {
  discardWorkingDraftForDocument,
  getAutosaveForDocument,
  getVersionDiffForDocument,
  getVersionForDocument,
  listVersionsForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const POSTS = "hlr_posts";
const SITE = "hlr_site";
/** Readable in Spanish alone. */
const SPANISH_ONLY = "hlr_spanish_only";
const SPANISH_ONLY_SITE = "hlr_spanish_only_site";

/** Readable in any language but Spanish. */
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SPANISH_ONLY,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: ({ locale }: { locale?: string }) => locale === "es" },
        fields: [
          text({ name: "title" }),
          // Translated, and withheld from a read in Spanish.
          text({ name: "note", access: { read: notSpanish } }),
        ],
      }),
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SPANISH_ONLY_SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: ({ locale }: { locale?: string }) => locale === "es" },
        fields: [text({ name: "title" })],
      }),
      defineSingle({
        slug: SITE,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: { read: notSpanish },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

/** A post written in English and in Spanish, as a trusted server writes it. */
async function bilingualPost(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: POSTS,
    locale: "en",
    data: { title: "Harbour", status: "published" },
  });
  const id = String(created.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "es",
    data: { title: "Puerto", status: "published", _overwrite: true },
  });
  return id;
}

/**
 * A document readable in Spanish alone, saved once in English and twice in
 * Spanish by a trusted server, with its English version and latest Spanish
 * one. The Spanish saves carry a note a Spanish read withholds.
 */
async function spanishOnlyHistory(
  t: TestNextly,
  scopeKind: "collection" | "single"
): Promise<{ id: string; english: number; spanish: number }> {
  const saves = [
    ["en", { title: "Harbour", note: "harbour-note" }],
    ["es", { title: "Puerto", note: "nota-secreta" }],
    ["es", { title: "Puerto 2", note: "nota-secreta-2" }],
  ] as const;
  let id = "";
  for (const [locale, data] of saves) {
    if (scopeKind === "single") {
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean; data?: { id?: unknown } | null }>;
      };
      const saved = await singles.update(
        SPANISH_ONLY_SITE,
        { title: data.title, status: "published", _overwrite: true },
        { locale, overrideAccess: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      id = String(saved.data?.id ?? id);
    } else if (id === "") {
      id = String(
        (
          await t.nextly.create({
            collection: SPANISH_ONLY,
            locale,
            data: { ...data, status: "published" },
          })
        ).item.id
      );
    } else {
      await t.nextly.update({
        collection: SPANISH_ONLY,
        id,
        locale,
        data: { ...data, status: "published", _overwrite: true },
      });
    }
  }
  const versions = t.getService("versionsService") as unknown as {
    list(
      ref: Record<string, string>
    ): Promise<{ locale: string | null; versionNo: number }[]>;
  };
  // Newest first.
  const all = await versions.list({
    scopeKind,
    scopeSlug: scopeKind === "single" ? SPANISH_ONLY_SITE : SPANISH_ONLY,
    entryId: id,
  });
  const english = all.find(v => v.locale === "en");
  const spanish = all.find(v => v.locale === "es");
  expect(english, "an English version is stored").toBeDefined();
  expect(spanish, "a Spanish version is stored").toBeDefined();
  return { id, english: english!.versionNo, spanish: spanish!.versionNo };
}

/**
 * A role-based API key, made by a super-admin, whose role may read `slug` and
 * nothing else: a caller of the published version routes, which take a
 * session or a key.
 */
async function keyThatMayRead(
  t: TestNextly,
  name: string,
  slug: string
): Promise<string> {
  // Seeds the permission where the boot did not.
  await userWhoMay(t, `${name}-holder`, "read", [slug]);
  const api = t.nextly as unknown as {
    permissions: {
      find(a: { limit: number }): Promise<{
        items: { id: string; slug: string }[];
      }>;
    };
    roles: {
      create(a: { data: Record<string, unknown> }): Promise<{
        item: { id: string };
      }>;
    };
  };
  const permission = (await api.permissions.find({ limit: 1000 })).items.find(
    p => p.slug === `read-${slug}`
  );
  expect(permission, `read-${slug} is seeded`).toBeDefined();
  const role = await api.roles.create({
    data: {
      name: `Key ${name}`,
      slug: `key-${name}`,
      permissionIds: [permission!.id],
    },
  });
  const founder = await superAdminUser(t, `${name}-founder`);
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey(
      userId: string,
      input: Record<string, unknown>
    ): Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(founder, {
    name,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "unlimited",
  });
  return key;
}

/** Whether `read` settles, keeping the refusal's code where it is refused. */
const outcome = (read: Promise<unknown>) =>
  read.then(
    () => "readable",
    (error: unknown) =>
      `refused ${String((error as { code?: unknown }).code ?? error)}`
  );

describe.each(getConfiguredTestDialects())(
  "history in a language the read rule refuses (integration, %s)",
  dialect => {
    it("leaves out an entry's history in a language its read rule refuses", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: POSTS,
        locale: "en",
        data: { title: "Harbour", status: "published" },
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: POSTS,
        id,
        locale: "es",
        data: { title: "Puerto", status: "published", _overwrite: true },
      });
      const reader = await userWhoMay(t, "hlr-reader", "read", [POSTS]);

      const readable = await readableHistoryLocales(
        "collection",
        POSTS,
        id,
        { id: reader } as never,
        undefined,
        {},
        ["en", "es"]
      );
      // The reader may read the entry in English: the fixture reaches the rule.
      expect(readable.has("en")).toBe(true);
      expect(readable.has("es")).toBe(false);
    }, 90_000);

    // A document readable in one language only has history in that
    // language: the document is not refused for the language it cannot be
    // read in by default.
    it("opens history in the only language a read rule admits", async () => {
      const t = await boot(dialect);
      const created = await t.nextly.create({
        collection: SPANISH_ONLY,
        locale: "en",
        data: { title: "Harbour", status: "published" },
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: SPANISH_ONLY,
        id,
        locale: "es",
        data: { title: "Puerto", status: "published", _overwrite: true },
      });
      const reader = await userWhoMay(t, "hlr-es-reader", "read", [
        SPANISH_ONLY,
      ]);
      const asReader = (locales: string[]) =>
        assertVersionDocumentReadable(
          "collection",
          SPANISH_ONLY,
          id,
          { id: reader } as never,
          undefined,
          {},
          locales
        );

      // Opened, answering the one language the reader may read it in.
      await expect(asReader(["es"])).resolves.toEqual(new Set(["es"]));
      await expect(asReader([])).resolves.toEqual(new Set(["es"]));
      await expect(asReader(["en"])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 90_000);

    it("opens a Single's history in the only language a read rule admits", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean; data?: { id?: unknown } | null }>;
      };
      let id = "";
      for (const [locale, title] of [
        ["en", "Site"],
        ["es", "Sitio"],
      ] as const) {
        const saved = await singles.update(
          SPANISH_ONLY_SITE,
          { title, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        id = String(saved.data?.id ?? id);
      }
      const reader = await userWhoMay(t, "hlr-es-site-reader", "read", [
        SPANISH_ONLY_SITE,
      ]);
      const asReader = (locales: string[]) =>
        assertVersionDocumentReadable(
          "single",
          SPANISH_ONLY_SITE,
          id,
          { id: reader } as never,
          undefined,
          {},
          locales
        );

      // Opened, answering the one language the reader may read it in.
      await expect(asReader(["es"])).resolves.toEqual(new Set(["es"]));
      await expect(asReader([])).resolves.toEqual(new Set(["es"]));
      await expect(asReader(["en"])).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 90_000);

    // History opened in the only language the rule admits holds that
    // language alone: a read that names no language leaves out every version,
    // snapshot and comparison part in a language the reader cannot read.
    it.each([
      { scopeKind: "collection" as const, slug: SPANISH_ONLY, en: "Harbour" },
      { scopeKind: "single" as const, slug: SPANISH_ONLY_SITE, en: "Site" },
    ])(
      "keeps an unscoped $scopeKind history to the only language a read rule admits",
      async ({ scopeKind, slug, en }) => {
        const t = await boot(dialect);
        let id = "";
        if (scopeKind === "collection") {
          id = String(
            (
              await t.nextly.create({
                collection: slug,
                locale: "en",
                data: { title: en, status: "published" },
              })
            ).item.id
          );
          // Two Spanish saves, so Spanish has a comparison of its own.
          for (const title of ["Puerto", "Puerto 2"]) {
            await t.nextly.update({
              collection: slug,
              id,
              locale: "es",
              data: { title, status: "published", _overwrite: true },
            });
          }
        } else {
          const singles = t.getService("singleEntryService") as unknown as {
            update(
              slug: string,
              data: Record<string, unknown>,
              options: Record<string, unknown>
            ): Promise<{ success: boolean; data?: { id?: unknown } | null }>;
          };
          for (const [locale, title] of [
            ["en", en],
            ["es", "Sitio"],
            ["es", "Sitio 2"],
          ] as const) {
            const saved = await singles.update(
              slug,
              { title, status: "published", _overwrite: true },
              { locale, overrideAccess: true }
            );
            id = String(saved.data?.id ?? id);
          }
        }
        const reader = await userWhoMay(t, `hlr-es-${scopeKind}`, "read", [
          slug,
        ]);
        const versions = t.getService("versionsService") as unknown as {
          list(
            ref: Record<string, string>
          ): Promise<{ locale: string | null; versionNo: number }[]>;
        };
        const all = await versions.list({
          scopeKind,
          scopeSlug: slug,
          entryId: id,
        });
        const english = all.find(v => v.locale === "en");
        const spanish = all.find(v => v.locale === "es");
        expect(english, "an English version is stored").toBeDefined();
        expect(spanish, "a Spanish version is stored").toBeDefined();
        const as = { scopeKind, slug, entryId: id, user: { id: reader } };

        const listed = await listVersionsForDocument(as);
        expect(listed.items.map(v => v.locale)).toContain("es");
        expect(listed.items.map(v => v.locale)).not.toContain("en");
        expect(
          await outcome(
            getVersionForDocument({ ...as, versionNo: english!.versionNo })
          )
        ).toMatch(/^refused NOT_FOUND/);
        const own = await getVersionForDocument({
          ...as,
          versionNo: spanish!.versionNo,
        });
        expect(JSON.stringify(own)).not.toContain(en);
        // A comparison that names no language is of the default one, which
        // this reader may not read: refused. Named in the reader's language,
        // it holds nothing of the other.
        expect(await outcome(getVersionDiffForDocument(as))).toMatch(
          /^refused NOT_FOUND/
        );
        expect(
          JSON.stringify(
            await getVersionDiffForDocument({ ...as, locale: "es" })
          )
        ).not.toContain(en);
      },
      90_000
    );

    it("leaves out a Single's history in a language its read rule refuses", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update(
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ): Promise<{ success: boolean; data?: { id?: unknown } | null }>;
      };
      let id = "";
      for (const [locale, title] of [
        ["en", "Site"],
        ["es", "Sitio"],
      ] as const) {
        const saved = await singles.update(
          SITE,
          { title, status: "published", _overwrite: true },
          { locale, overrideAccess: true }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        id = String(saved.data?.id ?? id);
      }
      const reader = await userWhoMay(t, "hlr-site-reader", "read", [SITE]);

      const readable = await readableHistoryLocales(
        "single",
        SITE,
        id,
        { id: reader } as never,
        undefined,
        {},
        ["en", "es"]
      );
      expect(readable.has("en")).toBe(true);
      expect(readable.has("es")).toBe(false);
    }, 90_000);

    it("lists an entry's history only in the languages its read rule admits", async () => {
      const t = await boot(dialect);
      const id = await bilingualPost(t);
      const reader = await userWhoMay(t, "hlr-list-reader", "read", [POSTS]);
      const list = (locale?: string) =>
        listVersionsForDocument({
          scopeKind: "collection",
          slug: POSTS,
          entryId: id,
          user: { id: reader },
          ...(locale === undefined ? {} : { locale }),
        });

      // The history holds both languages, read by a trusted server.
      const versions = t.getService("versionsService") as unknown as {
        list(ref: Record<string, string>): Promise<{ locale: string | null }[]>;
      };
      const all = await versions.list({
        scopeKind: "collection",
        scopeSlug: POSTS,
        entryId: id,
      });
      expect(new Set(all.map(v => v.locale))).toEqual(new Set(["en", "es"]));
      // The reader may list English, and never Spanish.
      expect(await outcome(list("en"))).toBe("readable");
      expect(await outcome(list("es"))).toMatch(/^refused NOT_FOUND/);
      const unnamed = await list();
      expect(unnamed.items.map(v => v.locale)).toContain("en");
      expect(unnamed.items.map(v => v.locale)).not.toContain("es");
    }, 90_000);

    it("hands a discard back only in a language the read rule admits", async () => {
      const t = await boot(dialect);
      const id = await bilingualPost(t);
      const editor = await userWhoMay(t, "hlr-editor", "read", [POSTS]);
      await grantTo(t, editor, "update", [POSTS]);
      const discard = (locale: string) =>
        asCaller(sessionCaller({ userId: editor }), () =>
          discardWorkingDraftForDocument({
            scopeKind: "collection",
            slug: POSTS,
            entryId: id,
            user: { id: editor },
            locale,
            version: { _overwrite: true },
            params: { collectionName: POSTS, entryId: id },
          })
        );

      // The editor may discard in English and is handed the English document.
      expect(((await discard("en")) as { title?: string }).title).toBe(
        "Harbour"
      );
      // Spanish is refused rather than handed back.
      expect(await outcome(discard("es"))).toMatch(/^refused /);
    }, 90_000);
    // The published version routes judge a history read in the language it
    // names, and one naming none in any language its history holds, as the
    // document gate does: a rule admitting Spanish alone opens the Spanish
    // history to them, and nothing else.
    it.each([
      { scopeKind: "collection" as const, slug: SPANISH_ONLY },
      { scopeKind: "single" as const, slug: SPANISH_ONLY_SITE },
    ])(
      "opens the published $scopeKind history routes in the only language a read rule admits",
      async ({ scopeKind, slug }) => {
        const t = await boot(dialect);
        const { id, english, spanish } = await spanishOnlyHistory(t, scopeKind);
        const key = await keyThatMayRead(t, `hlr-route-${scopeKind}`, slug);
        const document = { kind: scopeKind, slug, id };
        const request = (path: string) =>
          new Request(`http://localhost/api/versions/${path}`, {
            headers: { authorization: `Bearer ${key}` },
          });
        const list = (search: string) =>
          listRoute(request(`${scopeKind}/${slug}/${id}${search}`), {
            params: Promise.resolve(document),
          });
        const detail = (versionNo: number) =>
          detailRoute(request(`${scopeKind}/${slug}/${id}/${versionNo}`), {
            params: Promise.resolve({
              ...document,
              versionNo: String(versionNo),
            }),
          });
        const localesOf = async (response: Response) =>
          (
            (await response.json()) as { items: { locale: string | null }[] }
          ).items.map(item => item.locale);

        const spanishList = await list("?locale=es");
        expect(spanishList.status).toBe(200);
        expect(new Set(await localesOf(spanishList))).toEqual(new Set(["es"]));
        const unnamed = await list("");
        expect(unnamed.status).toBe(200);
        expect(new Set(await localesOf(unnamed))).toEqual(new Set(["es"]));
        expect((await detail(spanish)).status).toBe(200);
        // English stays refused, by the route or the document gate.
        expect((await list("?locale=en")).ok).toBe(false);
        expect((await detail(english)).ok).toBe(false);
      },
      90_000
    );

    // A field rule judging by language is told a version's own language
    // when its snapshot is redacted, as an ordinary read in that language
    // tells it: a note withheld from a Spanish read is withheld from a
    // Spanish version and a comparison of two.
    it("withholds a field from a version in the language its read rule withholds it in", async () => {
      const t = await boot(dialect);
      const { id, spanish } = await spanishOnlyHistory(t, "collection");
      const reader = await userWhoMay(t, "hlr-note-reader", "read", [
        SPANISH_ONLY,
      ]);
      // The ordinary Spanish read withholds the note: the rule reaches it.
      const read = await t.nextly.findByID({
        collection: SPANISH_ONLY,
        id,
        locale: "es",
        user: { id: reader },
        overrideAccess: false,
      } as never);
      expect(JSON.stringify(read)).toContain("Puerto 2");
      expect(JSON.stringify(read)).not.toContain("nota-secreta");
      const as = {
        scopeKind: "collection" as const,
        slug: SPANISH_ONLY,
        entryId: id,
        user: { id: reader },
      };

      const version = await getVersionForDocument({
        ...as,
        versionNo: spanish,
      });
      expect(JSON.stringify(version.snapshot)).toContain("Puerto 2");
      expect(JSON.stringify(version.snapshot)).not.toContain("nota-secreta");
      expect(version.withheld).toContain("note");
      const diff = await getVersionDiffForDocument({ ...as, locale: "es" });
      expect(JSON.stringify(diff)).toContain("Puerto");
      expect(JSON.stringify(diff)).not.toContain("nota-secreta");
    }, 90_000);

    // A reader's own recovery point in a language the read rule refuses them
    // is answered as no recovery point at all, so its existence is not told.
    it("answers a recovery point in a language the read rule refuses as none", async () => {
      const t = await boot(dialect);
      const id = await bilingualPost(t);
      const reader = await userWhoMay(t, "hlr-autosave-reader", "read", [
        POSTS,
      ]);
      const versions = t.getService("versionsService") as unknown as {
        autosave(input: Record<string, unknown>): Promise<unknown>;
      };
      // Saved under the reader's id by a trusted server, in each language.
      const autosave = (locale: string, title: string) =>
        versions.autosave({
          ref: { scopeKind: "collection", scopeSlug: POSTS, entryId: id },
          status: "draft",
          snapshot: { title },
          locale,
          createdBy: reader,
        });
      const readBack = () =>
        asCaller(sessionCaller({ userId: reader }), () =>
          getAutosaveForDocument({
            scopeKind: "collection",
            slug: POSTS,
            entryId: id,
            user: { id: reader },
            params: { collectionName: POSTS, entryId: id },
          })
        );

      await autosave("en", "Harbour draft");
      // The reader reads their English point back: the fixture reaches it.
      expect(JSON.stringify(await readBack())).toContain("Harbour draft");
      await autosave("es", "Puerto borrador");
      expect(await readBack()).toBeNull();
    }, 90_000);
  }
);
