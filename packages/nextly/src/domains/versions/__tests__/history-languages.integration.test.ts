/**
 * A document's history, read per language, on every dialect.
 *
 * A read hook can answer differently for each language of a localized
 * document, because it is handed that language's values. Version history and
 * content events ask it about each language they return: a read naming a
 * language the caller may not read is refused, and a read naming none returns
 * only the languages they may read, with the entries about the whole document.
 * The same holds on every way in, as the document read on that way in answers
 * (the per-language case of the parity matrix in
 * `content-events/__tests__/subject-events-read.integration.test.ts`).
 *
 * And which document a history read authorized is the read's own report of
 * the row it loaded, so a hook projecting `id` out of the output neither
 * refuses an allowed reader nor admits a redirected one.
 */

// Set before the harness boots: signing API keys reads it once.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { GET as listRoute } from "../../../api/versions";
import { GET as detailRoute } from "../../../api/versions-detail";
import { GET as diffRoute } from "../../../api/versions-diff";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  getVersionDiffForDocument,
  getVersionForDocument,
  listVersionsForDocument,
  markVersionSeenForDocument,
} from "../../../dispatcher/handlers/versions-methods";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NextlyError } from "../../../errors/nextly-error";
import { createDynamicHandlers } from "../../../routeHandler";
import { SHARED_PART } from "../../../schemas/content-events";
import type { VersionScopeKind } from "../../../schemas/versions/types";
import { ServiceContainer } from "../../../services/index";
import type { AuthUserId } from "../../../types/auth";
import { ensureCoreContentEventKinds } from "../../content-events/core-kinds";
import { recordContentEvent } from "../../content-events/record";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import { VersionsRepository } from "../versions-repository";

let current: TestNextly | undefined;
let services: PluginContext["services"] | undefined;
/** The first user: a super-admin by being first. It mints every key. */
let founder: string | undefined;
/** A read of `from` that the "projected" hook sends to `to` instead. */
let redirect: { from: string; to: string } | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
  founder = undefined;
  redirect = undefined;
});

/**
 * Refuses a person a document whose region, in the language read, is closed:
 * a hook that answers per language because it is handed that language's
 * values. A typed refusal, as a hook refuses a read; any other throw is the
 * read failing.
 */
const closedRegion = ({
  data,
  user,
  req,
}: {
  data?: unknown;
  user?: unknown;
  req?: { headers?: Record<string, string> };
}) => {
  if (
    user !== undefined &&
    (data as { region?: string } | undefined)?.region === "closed" &&
    // A pass the request carries opens it, as a hook trusting a verified
    // header does.
    req?.headers?.["x-region-pass"] !== "yes"
  ) {
    throw NextlyError.forbidden({ logContext: { reason: "region-closed" } });
  }
  return data;
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const probe = definePlugin({
    name: "@test/history-languages",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      services = ctx.services;
    },
  });
  current = await createTestNextly({
    dialect,
    collections: [
      // Open in English, closed in Spanish, with a field both share.
      defineCollection({
        slug: "regional",
        localized: true,
        versions: true,
        hooks: { afterRead: [closedRegion] },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "region", localized: true }),
          text({ name: "code" }),
        ],
      }),
      // No languages of its own, in an install that has them.
      defineCollection({
        slug: "plain",
        versions: true,
        fields: [text({ name: "title" })],
      }),
      // A hook that projects `id` out of every read, and one that sends a
      // read of one id to another document.
      defineCollection({
        slug: "projected",
        versions: true,
        hooks: {
          beforeOperation: [
            ({ operation, args }) => {
              const id = (args as { id?: unknown } | undefined)?.id;
              return operation === "read" &&
                redirect !== undefined &&
                id === redirect.from
                ? { ...args, id: redirect.to }
                : args;
            },
          ],
          afterRead: [
            ({ data }) => ({
              title: (data as { title?: string } | undefined)?.title,
            }),
          ],
        },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "bulletin",
        localized: true,
        status: true,
        versions: true,
        hooks: { afterRead: [closedRegion] },
        fields: [
          text({ name: "headline", localized: true }),
          text({ name: "region", localized: true }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    plugins: [probe],
  });
  await seedPermissionsAndRolePresets();
  founder = await seedLiveAuthor(current);
  return current;
}

let roleSeq = 0;

/** A role holding exactly these permissions, by slug. */
async function roleHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const permissions = await t.adapter.select<{ id: string; slug: string }>(
    "permissions",
    {}
  );
  const ids = slugs.map(slug => {
    const found = permissions.find(p => p.slug === slug);
    // Asserted, so a refusal below cannot be for a permission never seeded.
    expect(found, `${slug} is seeded`).toBeDefined();
    return String(found!.id);
  });
  roleSeq += 1;
  const role = await new ServiceContainer(t.adapter).roles.createRole({
    name: `History role ${roleSeq}`,
    slug: `history-role-${roleSeq}`,
    permissionIds: ids,
  });
  return role.id;
}

/** An active person whose only role holds exactly these permissions. */
async function personHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const user = await seedLiveAuthor(t);
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(user, await roleHolding(t, slugs));
  expect(assigned.success).toBe(true);
  return user;
}

/** A role-based API key whose role holds exactly these permissions. */
async function keyHolding(t: TestNextly, slugs: string[]): Promise<string> {
  const apiKeys = t.getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(founder!, {
    name: `history key ${roleSeq}`,
    tokenType: "role-based",
    roleId: await roleHolding(t, slugs),
    expiresIn: "unlimited",
  });
  return key;
}

/** A REST read, as a key, of a path under the API with its query. */
async function restGet(
  key: string,
  segments: string[],
  query: Record<string, string> = {},
  headers: Record<string, string> = {}
): Promise<Response> {
  const search = new URLSearchParams(query).toString();
  const request = new Request(
    `http://localhost/api/${segments.join("/")}${search ? `?${search}` : ""}`,
    { headers: { ...headers, authorization: `Bearer ${key}` } }
  );
  return createDynamicHandlers().GET(request, {
    params: Promise.resolve({ params: segments }),
  });
}

const asPerson = (userId: string) => ({
  user: { id: userId },
  overrideAccess: false,
});

const outcome = (read: Promise<unknown>) =>
  read.then(
    () => "readable",
    () => "refused"
  );

/**
 * A regional document: created in English, saved twice in Spanish, its
 * shared field saved alone, then saved in English again. A save of the shared
 * field is a version of the language it was saved in, and an event of the
 * shared part.
 */
async function regionalDocument(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: "regional",
    data: { title: "hello", region: "open", code: "c1" },
    locale: "en",
  });
  const id = (created.item as { id: string }).id;
  for (const title of ["hola", "hola de nuevo"]) {
    await t.nextly.update({
      collection: "regional",
      id,
      data: { title, region: "closed" },
      locale: "es",
    });
  }
  await t.nextly.update({
    collection: "regional",
    id,
    data: { code: "c2" },
    locale: "en",
  });
  await t.nextly.update({
    collection: "regional",
    id,
    data: { title: "hello again" },
    locale: "en",
  });
  return id;
}

/** Each durable version's number, by its language, oldest first. */
async function versionsByLanguage(
  t: TestNextly,
  scopeKind: VersionScopeKind,
  slug: string,
  entryId: string
): Promise<Map<string | null, number[]>> {
  const rows = await t
    .getService("versionsService")
    .list({ scopeKind, scopeSlug: slug, entryId }, { limit: 100 });
  const byLanguage = new Map<string | null, number[]>();
  for (const row of [...rows].reverse()) {
    if (typeof row.versionNo !== "number") continue;
    byLanguage.set(row.locale, [
      ...(byLanguage.get(row.locale) ?? []),
      row.versionNo,
    ]);
  }
  return byLanguage;
}

describe.each(getConfiguredTestDialects())(
  "a document's history, per language (integration, %s)",
  dialect => {
    it("asks the document's hooks about each language its history names", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-regional"]);
      const id = await regionalDocument(t);
      const subject = { kind: "collection" as const, slug: "regional", id };
      const document = {
        scopeKind: "collection" as const,
        slug: "regional",
        entryId: id,
        user: { id: reader },
      };
      const byLanguage = await versionsByLanguage(
        t,
        "collection",
        "regional",
        id
      );
      const es = byLanguage.get("es") ?? [];
      const en = byLanguage.get("en") ?? [];
      expect(es.length, "two Spanish versions").toBe(2);
      expect(en.length, "English versions to compare").toBeGreaterThan(1);

      // The document read itself: open in English, closed in Spanish.
      const read = (locale: string) =>
        outcome(
          t.nextly.findByID({
            collection: "regional",
            id,
            locale,
            ...asPerson(reader),
          })
        );
      expect([await read("en"), await read("es")]).toEqual([
        "readable",
        "refused",
      ]);

      const history = (language: "en" | "es", versions: number[]) =>
        Promise.all([
          outcome(
            t.nextly.contentEvents.list({
              subject,
              parts: [language],
              ...asPerson(reader),
            })
          ),
          outcome(listVersionsForDocument({ ...document, locale: language })),
          outcome(
            getVersionForDocument({ ...document, versionNo: versions[0]! })
          ),
          outcome(
            getVersionDiffForDocument({
              ...document,
              from: versions[0]!,
              to: versions[1]!,
            })
          ),
          // A comparison the server pairs, scoped to the language.
          outcome(getVersionDiffForDocument({ ...document, locale: language })),
          outcome(
            markVersionSeenForDocument({ ...document, versionNo: versions[1]! })
          ),
        ]);
      expect(await history("en", en)).toEqual(Array(6).fill("readable"));
      expect(await history("es", es)).toEqual(Array(6).fill("refused"));

      // A comparison the server cannot pair says why to a reader of its
      // language, and is not found to anyone else.
      const unpaired = (language: "en" | "es", to: number) =>
        getVersionDiffForDocument({ ...document, locale: language, to }).then(
          () => "paired",
          (error: { code?: string }) => error.code
        );
      expect([
        await unpaired("en", en[0]!),
        await unpaired("es", es[0]!),
      ]).toEqual(["VALIDATION_ERROR", "NOT_FOUND"]);
    }, 120_000);

    it("returns only the languages the caller may read when the history names none", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-regional", "read-plain"]);
      const id = await regionalDocument(t);
      const byLanguage = await versionsByLanguage(
        t,
        "collection",
        "regional",
        id
      );
      expect(byLanguage.get("es"), "Spanish versions").toBeDefined();
      // Two events of the shared fields, as a plugin records them: one of
      // them alone, and one that also involved Spanish.
      const subject = { kind: "collection" as const, slug: "regional", id };
      ensureCoreContentEventKinds();
      for (const [note, locales] of [
        ["shared alone", []],
        ["shared and Spanish", ["es"]],
      ] as const) {
        await t.adapter.transaction(tx =>
          recordContentEvent(tx, {
            subject,
            kind: "saved",
            actor: { kind: "system" },
            note,
            parts: { locales, shared: true },
          })
        );
      }

      const events = await t.nextly.contentEvents.list({
        subject,
        ...asPerson(reader),
      });
      const everyEvent = await t.nextly.contentEvents.list({ subject });
      // Trusted code sees the Spanish saves the reader does not.
      expect(
        everyEvent.items.filter(e => e.parts.join() === "es")
      ).toHaveLength(2);
      expect(events.items).toHaveLength(everyEvent.items.length - 2);
      expect(events.items.flatMap(event => event.parts)).not.toContain("es");
      // The shared fields' events stay, the one that also involved Spanish
      // narrowed to the part the reader may see.
      expect(
        events.items
          .filter(event => event.note !== null)
          .map(event => [event.note, event.parts])
      ).toEqual([
        ["shared and Spanish", [SHARED_PART]],
        ["shared alone", [SHARED_PART]],
      ]);

      const versions = await listVersionsForDocument({
        scopeKind: "collection",
        slug: "regional",
        entryId: id,
        user: { id: reader },
      });
      expect(versions.items.map(v => v.versionNo).sort()).toEqual(
        [...byLanguage]
          .filter(([language]) => language !== "es")
          .flatMap(([, numbers]) => numbers)
          .sort()
      );

      // A document with no languages keeps all of its history.
      const created = await t.nextly.create({
        collection: "plain",
        data: { title: "one" },
      });
      const plainId = (created.item as { id: string }).id;
      await t.nextly.update({
        collection: "plain",
        id: plainId,
        data: { title: "two" },
      });
      // Its versions are of no language, which the readable languages do not
      // name.
      expect([
        ...(await versionsByLanguage(t, "collection", "plain", plainId)).keys(),
      ]).toEqual([null]);
      const plain = await listVersionsForDocument({
        scopeKind: "collection",
        slug: "plain",
        entryId: plainId,
        user: { id: reader },
      });
      expect(plain.items).toHaveLength(2);
      const plainEvents = await t.nextly.contentEvents.list({
        subject: { kind: "collection", slug: "plain", id: plainId },
        ...asPerson(reader),
      });
      expect(plainEvents.items.map(e => e.kind)).toEqual(["saved", "created"]);
    }, 120_000);

    it("asks a Single's hooks about each language, and narrows an event that moved several", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-bulletin"]);
      const singles = t.getService("singleEntryService");
      const as = { overrideAccess: true };
      const written = await singles.update(
        "bulletin",
        { headline: "hello", region: "open" },
        { ...as, locale: "en" }
      );
      expect(written.success).toBe(true);
      const id = String((written.data as { id: unknown }).id);
      expect(
        (
          await singles.update(
            "bulletin",
            { headline: "hola", region: "closed" },
            { ...as, locale: "es" }
          )
        ).success
      ).toBe(true);
      expect((await singles.publishAllLocales("bulletin", as)).success).toBe(
        true
      );
      const subject = { kind: "single" as const, slug: "bulletin", id };
      const document = {
        scopeKind: "single" as const,
        slug: "bulletin",
        entryId: id,
        user: { id: reader },
      };

      const named = (language: "en" | "es") =>
        Promise.all([
          outcome(
            t.nextly.contentEvents.list({
              subject,
              parts: [language],
              ...asPerson(reader),
            })
          ),
          outcome(listVersionsForDocument({ ...document, locale: language })),
        ]);
      expect(await named("en")).toEqual(["readable", "readable"]);
      expect(await named("es")).toEqual(["refused", "refused"]);

      // Publishing both languages is one event; the reader sees its English.
      const events = await t.nextly.contentEvents.list({
        subject,
        ...asPerson(reader),
      });
      const published = events.items.filter(e => e.kind === "published");
      expect(published.map(e => e.parts)).toEqual([["en"]]);
      expect(events.items.flatMap(e => e.parts)).not.toContain("es");
      const versions = await listVersionsForDocument(document);
      expect(versions.items.map(v => v.locale)).toContain("en");
      expect(versions.items.map(v => v.locale)).not.toContain("es");
    }, 120_000);

    it("answers a language on every way in as the document's read in that language does", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-regional"]);
      const key = await keyHolding(t, ["read-regional"]);
      const id = await regionalDocument(t);
      const subject = { kind: "collection" as const, slug: "regional", id };
      const okOrNot = (response: Promise<Response>) =>
        response.then(r => (r.ok ? "readable" : "refused"));
      const as = {
        as: "user" as const,
        user: { id: reader as AuthUserId, email: `${reader}@example.com` },
      };
      const entry = ["collections", "regional", "entries", id];
      const byLanguage = await versionsByLanguage(
        t,
        "collection",
        "regional",
        id
      );
      // The published version routes, called as an app's route file does.
      const routeRequest = (
        path: string,
        headers: Record<string, string> = {}
      ) =>
        new Request(`http://localhost/api/versions/${path}`, {
          headers: { ...headers, authorization: `Bearer ${key}` },
        });
      const document = { kind: "collection", slug: "regional", id };
      const standalone = (
        locale: "en" | "es",
        headers: Record<string, string>
      ) => {
        const [from, to] = byLanguage.get(locale) ?? [];
        return [
          listRoute(
            routeRequest(`collection/regional/${id}?locale=${locale}`, headers),
            { params: Promise.resolve(document) }
          ),
          detailRoute(
            routeRequest(`collection/regional/${id}/${from}`, headers),
            {
              params: Promise.resolve({ ...document, versionNo: String(from) }),
            }
          ),
          diffRoute(
            routeRequest(
              `collection/regional/${id}/diff?from=${from}&to=${to}`,
              headers
            ),
            { params: Promise.resolve(document) }
          ),
        ];
      };
      // REST and the published routes, the request carrying these headers.
      const restWays = async (
        locale: "en" | "es",
        headers: Record<string, string> = {}
      ) => [
        await okOrNot(restGet(key, entry, { locale }, headers)),
        await okOrNot(
          restGet(key, [...entry, "events"], { part: locale }, headers)
        ),
        await okOrNot(
          restGet(key, [...entry, "versions"], { locale }, headers)
        ),
        ...(await Promise.all(standalone(locale, headers).map(okOrNot))),
      ];

      const waysIn = async (locale: "en" | "es") => ({
        rest: await restWays(locale),
        directApi: [
          await outcome(
            t.nextly.findByID({
              collection: "regional",
              id,
              locale,
              ...asPerson(reader),
            })
          ),
          await outcome(
            t.nextly.contentEvents.list({
              subject,
              parts: [locale],
              ...asPerson(reader),
            })
          ),
        ],
        plugin: [
          await outcome(
            services!.collections.findEntryById("regional", id, {
              ...as,
              locale,
            })
          ),
          await outcome(
            services!.versions.listEvents(subject, { parts: [locale] }, as)
          ),
        ],
      });

      for (const locale of ["en", "es"] as const) {
        const ways = await waysIn(locale);
        // Each history read answers as the document read on its way in.
        for (const [way, [documentRead, ...historyReads]] of Object.entries(
          ways
        )) {
          for (const historyRead of historyReads) {
            expect(historyRead, `${way} ${locale}`).toBe(documentRead);
          }
        }
        // And each document read answers as the hook does in that language:
        // the control that makes the comparison mean something.
        const expected = locale === "en" ? "readable" : "refused";
        expect(
          [ways.rest[0], ways.directApi[0], ways.plugin[0]],
          locale
        ).toEqual([expected, expected, expected]);
      }

      // The request behind a history read reaches the hooks of every
      // language it asks about, as it reaches the document read beside it:
      // a pass that opens Spanish to the document read opens its history.
      expect(await restWays("es", { "x-region-pass": "yes" })).toEqual(
        Array(6).fill("readable")
      );

      // The published list route, naming no language, lists none it refuses.
      const listed = await listRoute(
        routeRequest(`collection/regional/${id}`),
        { params: Promise.resolve(document) }
      );
      expect(listed.status, await listed.clone().text()).toBe(200);
      const { items } = (await listed.json()) as {
        items: { locale: string | null }[];
      };
      expect(items.map(item => item.locale)).toContain("en");
      expect(items.map(item => item.locale)).not.toContain("es");
    }, 120_000);

    it("withholds history recorded in a language once the install configures none", async () => {
      // An install without localization, holding history from when it had it.
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "plain",
            versions: true,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const t = current;
      await seedPermissionsAndRolePresets();
      founder = await seedLiveAuthor(t);
      const reader = await personHolding(t, ["read-plain"]);
      const created = await t.nextly.create({
        collection: "plain",
        data: { title: "one" },
      });
      const id = (created.item as { id: string }).id;
      await t.nextly.update({
        collection: "plain",
        id,
        data: { title: "two" },
      });
      const subject = { kind: "collection" as const, slug: "plain", id };
      const repo = new VersionsRepository(
        t.adapter as unknown as ConstructorParameters<
          typeof VersionsRepository
        >[0]
      );
      await repo.insertVersion({
        ref: { scopeKind: "collection", scopeSlug: "plain", entryId: id },
        versionNo: 3,
        status: "draft",
        isAutosave: false,
        snapshot: { title: "dos" },
        locale: "es",
      });
      ensureCoreContentEventKinds();
      await t.adapter.transaction(tx =>
        recordContentEvent(tx, {
          subject,
          kind: "saved",
          actor: { kind: "system" },
          note: "in Spanish, before",
          versionNo: 3,
          parts: { locales: ["es"] },
        })
      );
      const document = {
        scopeKind: "collection" as const,
        slug: "plain",
        entryId: id,
        user: { id: reader },
      };

      // Trusted code still reads all of it: the rows are there.
      expect(
        (await versionsByLanguage(t, "collection", "plain", id)).get("es")
      ).toEqual([3]);
      expect(
        (await t.nextly.contentEvents.list({ subject })).items.map(e => e.note)
      ).toContain("in Spanish, before");

      // A reader gets the document's history in no language, and none of it
      // in a language nothing can be asked about.
      const versions = await listVersionsForDocument(document);
      expect(versions.items.map(v => v.locale)).toEqual([null, null]);
      const events = await t.nextly.contentEvents.list({
        subject,
        ...asPerson(reader),
      });
      expect(events.items.map(e => e.kind)).toEqual(["saved", "created"]);
      expect(events.items.flatMap(e => e.parts)).not.toContain("es");
      expect([
        await outcome(listVersionsForDocument({ ...document, locale: "es" })),
        await outcome(getVersionForDocument({ ...document, versionNo: 3 })),
        await outcome(
          t.nextly.contentEvents.list({
            subject,
            parts: ["es"],
            ...asPerson(reader),
          })
        ),
      ]).toEqual(["refused", "refused", "refused"]);

      // Once the document is deleted its events are read without it, and a
      // language nothing can be asked about stays withheld.
      await t.nextly.delete({ collection: "plain", id });
      const afterDelete = await t.nextly.contentEvents.list({
        subject,
        ...asPerson(reader),
      });
      expect(afterDelete.items.map(e => e.kind)).toContain("deleted");
      expect(afterDelete.items.map(e => e.note)).not.toContain(
        "in Spanish, before"
      );
      expect(afterDelete.items.flatMap(e => e.parts)).not.toContain("es");
      expect(
        await outcome(
          t.nextly.contentEvents.list({
            subject,
            parts: ["es"],
            ...asPerson(reader),
          })
        )
      ).toBe("refused");
      expect(
        (await t.nextly.contentEvents.list({ subject })).items.map(e => e.note)
      ).toContain("in Spanish, before");
    }, 120_000);

    it("judges a history read by the document the read loaded, not by the id its output carries", async () => {
      const t = await boot(dialect);
      const reader = await personHolding(t, ["read-projected"]);
      for (const title of ["first", "second"]) {
        await t.nextly.create({ collection: "projected", data: { title } });
      }
      // The hook projects every read, so the ids come from storage.
      const stored = await t.adapter.select<{ id: string; title: string }>(
        "dc_projected",
        {}
      );
      const idOf = (title: string): string => {
        const row = stored.find(r => r.title === title);
        expect(row, title).toBeDefined();
        return String(row!.id);
      };
      const [first, second] = [idOf("first"), idOf("second")];
      const readBoth = async (id: string) => [
        await outcome(
          t.nextly.contentEvents.list({
            subject: { kind: "collection", slug: "projected", id },
            ...asPerson(reader),
          })
        ),
        await outcome(
          listVersionsForDocument({
            scopeKind: "collection",
            slug: "projected",
            entryId: id,
            user: { id: reader },
          })
        ),
      ];

      // The document read succeeds with no id in its output.
      expect(
        await outcome(
          t.nextly.findByID({
            collection: "projected",
            id: first,
            ...asPerson(reader),
          })
        )
      ).toBe("readable");
      expect(await readBoth(first)).toEqual(["readable", "readable"]);
      // A read of the first that a hook sends to the second authorizes
      // neither's history.
      redirect = { from: first, to: second };
      expect(await readBoth(first)).toEqual(["refused", "refused"]);
    }, 120_000);
  }
);
