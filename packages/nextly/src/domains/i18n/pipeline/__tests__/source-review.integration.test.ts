/**
 * What changed in a translated field's source since its translation was made, and "Keep current":
 * who may ask, what each answer is, and that keeping a translation moves its record alone.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../../auth/access/rule-answer";
import { apiKeyScope } from "../../../../auth/authenticated-scope";
import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../../config";
import { container } from "../../../../di/container";
import type { Nextly } from "../../../../direct-api/nextly";
import { NextlyError } from "../../../../errors";
import { getActiveHookRegistry } from "../../../../hooks/hook-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../../routeHandler";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { valueFingerprint } from "../../provenance/value-fingerprint";
import type { DocumentCaller, TranslatedDocument } from "../document-access";
import { keepCurrent, sourceChange } from "../source-review";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  resetSessionStandingForTests();
  await t?.destroy();
  t = undefined;
  clearRuleFilterReports();
});

const notEnglish = ({ locale }: { locale?: string }) => locale !== "en";
const notSpanish = ({ locale }: { locale?: string }) => locale !== "es";
/** The caller's own entries: a filter over the entry's `owner`. */
const ownEntries = ({ user }: { user: { id: string } | null }) =>
  ({ owner: { equals: user?.id ?? "" } }) as unknown as boolean;

async function boot(dialect: TestDialect): Promise<TestNextly> {
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "fr"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
          // Each rule told the language the field is read or written in.
          text({
            name: "hidden",
            localized: true,
            access: { read: () => false },
          }),
          text({
            name: "annOnly",
            localized: true,
            access: { read: ({ user }) => user?.id === "ann" },
          }),
          text({
            name: "sourceHidden",
            localized: true,
            access: { read: notEnglish },
          }),
          text({
            name: "locked",
            localized: true,
            access: { update: notSpanish },
          }),
          // What a reader is shown is not what is stored.
          text({
            name: "masked",
            localized: true,
            hooks: { afterRead: [() => "***"] },
          }),
        ],
      }),
      defineCollection({
        slug: "notes",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title", localized: true })],
      }),
      // Its update rule admits no Spanish.
      defineCollection({
        slug: "guarded",
        localized: true,
        access: { update: notSpanish },
        fields: [text({ name: "title", localized: true })],
      }),
      // Read and changed by their owner alone.
      defineCollection({
        slug: "owned",
        localized: true,
        access: { read: ownEntries, update: ownEntries },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "owner", localized: false }),
        ],
      }),
      // Changed in Spanish alone.
      defineCollection({
        slug: "spanish",
        localized: true,
        access: { update: ({ locale }) => locale === "es" },
        fields: [text({ name: "title", localized: true })],
      }),
      // Read by nobody.
      defineCollection({
        slug: "secrets",
        localized: true,
        access: { read: () => false },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
      defineSingle({
        slug: "unwritten",
        localized: true,
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  const slugs = [
    "posts",
    "notes",
    "guarded",
    "owned",
    "spanish",
    "secrets",
    "banner",
    "unwritten",
  ];
  await userWhoMay(t, "ann", "read", slugs);
  await grantTo(t, "ann", "update", slugs);
  // May read, and change nothing.
  await userWhoMay(t, "ben", "read", slugs);
  return t;
}

const ANN: DocumentCaller = {
  user: { id: "ann", email: "ann@x.test", roles: [] },
};
const BEN: DocumentCaller = {
  user: { id: "ben", email: "ben@x.test", roles: [] },
};

const handler = () => container.get<CollectionsHandler>("collectionsHandler");

async function save(
  document: TranslatedDocument,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  if (document.kind === "single") {
    await t!.nextly.updateSingle({
      slug: document.slug,
      locale,
      data: { ...data, _overwrite: true },
    } as never);
    return;
  }
  const result = await handler().updateEntry(
    {
      collectionName: document.slug,
      entryId: document.id,
      overrideAccess: true,
      locale,
      user: { id: "ann" },
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

async function entry(
  slug: string,
  data: Record<string, unknown>
): Promise<TranslatedDocument & { kind: "collection" }> {
  const created = (await t!.nextly.create({
    collection: slug,
    locale: "en",
    data,
  } as never)) as unknown as { item: { id: string } };
  return { kind: "collection", slug, id: created.item.id };
}

interface RecordRow {
  id: string;
  entryId: string;
  locale: string;
  partState: string;
  fieldPath: string;
  origin: string;
  engine: string | null;
  actorId: string | null;
  valueFingerprint: string;
  sourceLocale: string | null;
  sourceFingerprint: string | null;
}

/** One field's records in Spanish, live before draft. */
async function recordsOf(field = "title"): Promise<RecordRow[]> {
  const rows = await t!.adapter.select<RecordRow>(
    "nextly_translation_provenance"
  );
  return rows
    .filter(row => row.locale === "es" && row.fieldPath === field)
    .sort((a, b) => b.partState.localeCompare(a.partState));
}

async function valuesKept(): Promise<unknown[]> {
  const rows = await t!.adapter.select<{ content: { value: unknown } }>(
    "nextly_translation_sources"
  );
  return rows.map(row => row.content.value);
}

/** The code a refusal carries. */
async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (NextlyError.is(error)) return error.code;
    throw error;
  }
  return "not refused";
}

/** A REST request as Ann, and what it was answered. */
async function rest(
  method: "GET" | "POST",
  path: string[],
  query = "",
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const token = await signAccessToken(
    buildClaims({
      userId: "ann",
      email: "ann@x.test",
      name: "Ann",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers() as unknown as Record<
    string,
    (request: Request, context: unknown) => Promise<Response>
  >;
  const res = await handlers[method]!(
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  const json = (await res.json()) as Record<string, unknown>;
  return {
    status: res.status,
    data: (json.data ?? json) as Record<string, unknown>,
  };
}

/** An entry's REST path for one of the two operations. */
const entryPath = (
  document: TranslatedDocument & { kind: "collection" },
  action: "source-change" | "keep-current"
) => ["collections", document.slug, "entries", document.id, action];

/** Runs `work` in each transaction that locks a row of `table`, once it has. */
function whenLocked(
  table: string,
  work: (tx: TransactionContext) => Promise<unknown>
): void {
  const transaction = t!.adapter.transaction.bind(t!.adapter);
  vi.spyOn(t!.adapter, "transaction").mockImplementation((callback, options) =>
    transaction(tx => {
      const lockRow = tx.lockRow.bind(tx);
      tx.lockRow = async (locked, id) => {
        await lockRow(locked, id);
        if (locked === table) await work(tx);
      };
      return callback(tx);
    }, options)
  );
}

/** Has every Spanish record say its value was made from `locale`. */
async function madeFrom(locale: string): Promise<void> {
  await t!.adapter.update(
    "nextly_translation_provenance",
    { sourceLocale: locale },
    { and: [{ column: "locale", op: "=", value: "es" }] }
  );
}

/** A note live in Spanish, out of date, whose held draft cleared the Spanish title. */
async function clearedInDraft(): Promise<TranslatedDocument> {
  const note = await entry("notes", { title: "Hi" });
  await save(note, "en", { status: "published" });
  await save(note, "es", { title: "Hola", status: "published" });
  await save(note, "en", { title: "Hello" });
  await save(note, "en", { status: "published" });
  await save(note, "es", { title: "" });
  expect((await recordsOf()).map(row => row.partState)).toEqual(["live"]);
  return note;
}

const inSpanish = (field = "title") => ({ locale: "es", field });

/** A "Keep current" of what `sourceChange` shows `caller` of the field. */
async function keepShown(
  document: TranslatedDocument,
  caller: DocumentCaller = ANN,
  field = "title"
): Promise<void> {
  const shown = await sourceChange(document, caller, inSpanish(field));
  await keepCurrent(document, caller, {
    ...inSpanish(field),
    valueFingerprint: shown.valueFingerprint ?? "",
    sourceFingerprint: shown.sourceFingerprint ?? "",
  });
}

describe.each(getConfiguredTestDialects())(
  "what changed in a translated field's source (%s)",
  dialect => {
    it("is the source then and now, for an entry and for a Single", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      expect(await sourceChange(post, ANN, inSpanish())).toEqual({
        available: true,
        sourceLocale: "en",
        before: "Hi",
        after: "Hello",
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      });

      const banner = { kind: "single", slug: "banner" } as const;
      await save(banner, "en", { headline: "Sale" });
      await save(banner, "es", { headline: "Rebajas" });
      await save(banner, "en", { headline: "Big sale" });
      expect(
        await sourceChange(banner, ANN, inSpanish("headline"))
      ).toMatchObject({ available: true, before: "Sale", after: "Big sale" });
    });

    it("is of the language the value was made from", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "fr", { title: "Salut" });
      const french = await handler().getEntry({
        collectionName: "posts",
        entryId: post.id,
        locale: "fr",
        overrideAccess: true,
      });
      await save(post, "es", {
        title: "Salut",
        _provenance: {
          title: {
            origin: "copy",
            sourceLocale: "fr",
            sourceRevision: (french.data as Record<string, unknown>)._rev,
          },
        },
      });
      await save(post, "fr", { title: "Bonjour" });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: true,
        sourceLocale: "fr",
        before: "Salut",
        after: "Bonjour",
      });
    });

    it("tells a source that was empty from one that was not kept", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "en", { title: "" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const empty = await sourceChange(post, ANN, inSpanish());
      expect(empty).toMatchObject({
        available: true,
        before: "",
        after: "Hello",
      });

      await t!.adapter.delete("nextly_translation_sources", {
        and: [{ column: "fieldPath", op: "=", value: "title" }],
      });
      const lost = await sourceChange(post, ANN, inSpanish());
      expect(lost).toMatchObject({
        available: false,
        reason: "not-kept",
        sourceLocale: "en",
        after: "Hello",
      });
      expect(lost).not.toHaveProperty("before");
    });

    it("says why where there is nothing to show", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", {
        title: "Hi",
        _provenance: { title: { origin: "copy", sourceLocale: "en" } },
      });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: false,
        reason: "source-moved",
      });

      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "original" } },
      });
      const original = await sourceChange(post, ANN, inSpanish());
      expect(original).toMatchObject({ available: false, reason: "original" });
      // It has no source, so none is named and none is shown.
      expect(original).not.toHaveProperty("sourceLocale");
      expect(original).not.toHaveProperty("after");

      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "locale", op: "=", value: "es" }],
      });
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: false,
        reason: "unknown-origin",
        sourceLocale: "en",
        after: "Hi",
        valueFingerprint: valueFingerprint("Hola"),
      });
    });

    it("is of the held draft where there is one", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola 2" });
      expect(await sourceChange(note, ANN, inSpanish())).toMatchObject({
        available: true,
        before: "Hello",
        valueFingerprint: valueFingerprint("Hola 2"),
      });
    });

    it("shows no older text where a hook changes what the reader sees of the source", async () => {
      await boot(dialect);
      const post = await entry("posts", { masked: "Secret one" });
      await save(post, "es", { masked: "Secreto" });
      await save(post, "en", { masked: "Secret two" });
      const change = await sourceChange(post, ANN, inSpanish("masked"));
      expect(change).toMatchObject({
        available: false,
        reason: "not-kept",
        after: "***",
      });
      expect(JSON.stringify(change)).not.toContain("Secret");
    });

    it("shows no older text where a hook may change the field, though it left today's value as it is", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Secret" });
      await save(post, "es", { title: "Secreto" });
      await save(post, "en", { title: "" });
      // The control: nothing changes the read, so the older text is shown.
      expect(await sourceChange(post, ANN, inSpanish())).toMatchObject({
        available: true,
        before: "Secret",
      });

      // Withholds the title. It is empty now, so today's reads as it is stored.
      getActiveHookRegistry().register(
        "afterRead",
        "posts",
        ({ data }) => ({ ...(data as object), title: "" }) as never
      );
      const change = await sourceChange(post, ANN, inSpanish());
      expect(change).toMatchObject({ available: false, reason: "not-kept" });
      expect(JSON.stringify(change)).not.toContain("Secret");

      const banner = { kind: "single", slug: "banner" } as const;
      await save(banner, "en", { headline: "Secret" });
      await save(banner, "es", { headline: "Secreto" });
      await save(banner, "en", { headline: "" });
      expect(
        await sourceChange(banner, ANN, inSpanish("headline"))
      ).toMatchObject({ available: true, before: "Secret" });
      getActiveHookRegistry().register(
        "afterRead",
        "single:banner",
        ({ data }) => ({ ...(data as object), headline: "" }) as never
      );
      expect(
        await sourceChange(banner, ANN, inSpanish("headline"))
      ).toMatchObject({ available: false, reason: "not-kept" });
    });

    it("is of the live value for a reader who is not shown the held draft", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });
      // Held, and made from the source as it is now.
      await save(note, "es", { title: "Borrador" });

      expect(await sourceChange(note, BEN, inSpanish())).toMatchObject({
        available: true,
        before: "Hi",
        after: "Hello",
        valueFingerprint: valueFingerprint("Hola"),
      });
      // The control: an editor is shown the draft, and is told of it.
      expect(await sourceChange(note, ANN, inSpanish())).toMatchObject({
        before: "Hello",
        valueFingerprint: valueFingerprint("Borrador"),
      });
    });

    it("asks the field rules of a trusted call that asks for them, as whoever it names", async () => {
      await boot(dialect);
      const post = await entry("posts", { annOnly: "Secret" });
      await save(post, "es", { annOnly: "Secreto" });
      await save(post, "en", { annOnly: "Other" });
      const { translations } = t!.nextly as unknown as Nextly;
      const named = {
        collection: "posts",
        id: post.id,
        ...inSpanish("annOnly"),
        overrideAccess: true,
      };
      for (const narrowed of [
        { enforceFieldAccess: true },
        // Whoever makes the call, the rule is asked of the one it names.
        {
          enforceFieldAccess: true,
          user: { id: "ann" },
          fieldAccessUser: { id: "ben" },
        },
      ]) {
        expect(
          await refusalOf(translations.sourceChange({ ...named, ...narrowed }))
        ).toBe("NOT_FOUND");
      }
      const shown = { available: true, before: "Secret" };
      expect(
        await translations.sourceChange({
          ...named,
          enforceFieldAccess: true,
          user: { id: "ben" },
          fieldAccessUser: { id: "ann" },
        })
      ).toMatchObject(shown);
      // The control: a trusted call that does not ask for them.
      expect(await translations.sourceChange(named)).toMatchObject(shown);
    });

    it("names the fingerprint of the source it shows, where that is saved as it is read", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      const getEntry = handler().getEntry.bind(handler());
      let saved = 0;
      let saves = 0;
      const savedAfterRead = (times: number) => {
        saves = 0;
        vi.spyOn(handler(), "getEntry").mockImplementation(async params => {
          const answer = await getEntry(params);
          if (params.locale === "en" && saves < times) {
            saves += 1;
            saved += 1;
            await save(post, "en", { title: `Hello ${saved}` });
          }
          return answer;
        });
      };

      savedAfterRead(1);
      const shown = await sourceChange(post, ANN, inSpanish());
      expect(saves).toBe(1);
      expect(shown).toMatchObject({
        after: "Hello 1",
        sourceFingerprint: valueFingerprint("Hello 1"),
      });

      // Saved at every read: no fingerprint is given of a value that was not shown.
      savedAfterRead(9);
      expect(await sourceChange(post, ANN, inSpanish())).not.toHaveProperty(
        "sourceFingerprint"
      );
    });

    // Broken by naming the fingerprint the translation has once it was read, whatever it was then.
    it("names the fingerprint of the translation that was shown, where that is saved as it is read", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      const getEntry = handler().getEntry.bind(handler());
      let shown: unknown;
      let saved = 0;
      let left = 0;
      vi.spyOn(handler(), "getEntry").mockImplementation(async params => {
        const answer = await getEntry(params);
        if (params.locale === "es" && left > 0) {
          left -= 1;
          saved += 1;
          shown = (answer.data as { title?: unknown }).title;
          await save(post, "es", { title: `Hola ${saved}` });
        } else if (params.locale === "es") {
          shown = (answer.data as { title?: unknown }).title;
        }
        return answer;
      });

      // Saved at the first reading of it, and at the first two.
      for (const times of [1, 2]) {
        left = times;
        const { valueFingerprint: named } = await sourceChange(
          post,
          ANN,
          inSpanish()
        );
        expect(left).toBe(0);
        expect(named).toBe(valueFingerprint(shown));
      }

      // Saved at every one: no fingerprint is given of a value that was not shown.
      left = 99;
      expect(await sourceChange(post, ANN, inSpanish())).not.toHaveProperty(
        "valueFingerprint"
      );
    });

    it("tells of no source in a language the site no longer has", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await madeFrom("de");
      const change = await sourceChange(post, ANN, inSpanish());
      expect(change).toMatchObject({
        available: false,
        reason: "source-language-removed",
        sourceLocale: "de",
      });
      // Not the default language's value under the other's name.
      expect(change).not.toHaveProperty("after");
      expect(change).not.toHaveProperty("sourceFingerprint");
    });

    it("is not of the live value where the held draft cleared it", async () => {
      await boot(dialect);
      const note = await clearedInDraft();
      const change = await sourceChange(note, ANN, inSpanish());
      expect(change).toMatchObject({
        available: false,
        reason: "unknown-origin",
      });
      expect(change).not.toHaveProperty("valueFingerprint");
    });

    it("is read over REST by a person whose rule matches the entry, and by no other", async () => {
      await boot(dialect);
      const own = await entry("owned", { title: "Hi", owner: "ann" });
      const others = await entry("owned", { title: "Hi", owner: "ben" });
      for (const document of [own, others]) {
        await save(document, "es", { title: "Hola" });
        await save(document, "en", { title: "Hello" });
      }
      const query = "?locale=es&field=title";
      const shown = await rest("GET", entryPath(own, "source-change"), query);
      expect(shown.status, JSON.stringify(shown.data)).toBe(200);
      expect(shown.data).toMatchObject({ available: true, before: "Hi" });
      expect(
        (await rest("GET", entryPath(others, "source-change"), query)).status
      ).toBe(404);
    });

    it("answers not found, the same, for a document or field the reader may not read", async () => {
      await boot(dialect);
      const post = await entry("posts", {
        title: "Hi",
        hidden: "Hi",
        sourceHidden: "Hi",
      });
      await save(post, "es", {
        title: "Hola",
        hidden: "Hola",
        sourceHidden: "Hola",
      });
      const secret = await entry("secrets", { title: "Hi" });
      await save(secret, "es", { title: "Hola" });

      for (const [document, field] of [
        [post, "hidden"],
        // Read in Spanish, and not in the language it was made from.
        [post, "sourceHidden"],
        [secret, "title"],
        [{ ...post, id: "00000000-0000-4000-8000-000000000000" }, "title"],
        [{ kind: "single", slug: "unwritten" }, "headline"],
      ] as [TranslatedDocument, string][]) {
        expect(
          await refusalOf(sourceChange(document, ANN, inSpanish(field))),
          `${document.slug}.${field}`
        ).toBe("NOT_FOUND");
      }
      // Asking gave the Single no document.
      expect(await t!.adapter.select("single_unwritten")).toEqual([]);
    });

    it("refuses a language or a field that has no translation, by name", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi", code: "c1" });
      for (const named of [
        { locale: "en", field: "title" },
        { locale: "xx", field: "title" },
        { locale: "es", field: "code" },
      ]) {
        expect(await refusalOf(sourceChange(post, ANN, named))).toBe(
          "VALIDATION_ERROR"
        );
      }
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "keeping a translation as it is (%s)",
  dialect => {
    it("points its record at the source as it is now, and moves nothing else", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(post, "en", { title: "Hello" });
      const [before] = await recordsOf();
      const read = async () =>
        (
          await handler().getEntry({
            collectionName: "posts",
            entryId: post.id,
            locale: "es",
            overrideAccess: true,
          })
        ).data as Record<string, unknown>;
      const document = await read();

      await keepShown(post);

      const [after] = await recordsOf();
      expect(after).toEqual({
        ...before,
        sourceFingerprint: valueFingerprint("Hello"),
      });
      // The text, the version and the time it was saved are as they were.
      expect(await read()).toEqual(document);
      // The new version is what it is now held to, and the old one is named by nothing.
      expect(await valuesKept()).toEqual(["Hello"]);
    });

    it("is answered again when asked again", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      await keepShown(post);
      // Nothing left to change, which MySQL counts as no row: not a record that moved.
      await keepShown(post);
      expect(await valuesKept()).toEqual(["Hello"]);
    });

    it("keeps a Single's", async () => {
      await boot(dialect);
      const banner = { kind: "single", slug: "banner" } as const;
      await save(banner, "en", { headline: "Sale" });
      await save(banner, "es", { headline: "Rebajas" });
      await save(banner, "en", { headline: "Big sale" });
      await keepShown(banner, ANN, "headline");
      expect((await recordsOf("headline"))[0]?.sourceFingerprint).toBe(
        valueFingerprint("Big sale")
      );
    });

    it("marks the held draft's value, and leaves a different live one out of date", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      await save(note, "es", { title: "Hola 2" });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });

      await keepShown(note);
      expect(await recordsOf()).toEqual([
        expect.objectContaining({
          partState: "live",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
        expect.objectContaining({
          partState: "draft",
          sourceFingerprint: valueFingerprint("Hello"),
        }),
      ]);
    });

    it("marks both where a held record describes the live value too", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", { title: "Hola", status: "published" });
      // A claim is recorded though the value is the live one.
      await save(note, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });
      expect(await recordsOf()).toHaveLength(2);

      await keepShown(note);
      expect((await recordsOf()).map(row => row.sourceFingerprint)).toEqual([
        valueFingerprint("Hello"),
        valueFingerprint("Hello"),
      ]);
    });

    it("gives a value with no record one, of unknown origin", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await t!.adapter.delete("nextly_translation_provenance", {
        and: [{ column: "fieldPath", op: "=", value: "title" }],
      });
      await keepShown(post);
      expect(await recordsOf()).toEqual([
        expect.objectContaining({
          partState: "live",
          origin: "unknown",
          actorId: null,
          valueFingerprint: valueFingerprint("Hola"),
          sourceLocale: "en",
          sourceFingerprint: valueFingerprint("Hi"),
        }),
      ]);
    });

    it("is refused once the translation or the source is no longer what was shown", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const shown = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      };

      await save(post, "en", { title: "Hello again" });
      expect(await refusalOf(keepCurrent(post, ANN, shown))).toBe("CONFLICT");
      await save(post, "en", { title: "Hello" });
      await save(post, "es", { title: "Buenas" });
      expect(await refusalOf(keepCurrent(post, ANN, shown))).toBe("CONFLICT");
    });

    it("is refused where there is nothing to review, or nothing to review it against", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      const asked = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hi"),
      };
      // No Spanish at all.
      expect(await refusalOf(keepCurrent(post, ANN, asked))).toBe(
        "VALIDATION_ERROR"
      );
      await save(post, "es", {
        title: "Hola",
        _provenance: { title: { origin: "original" } },
      });
      expect(await refusalOf(keepCurrent(post, ANN, asked))).toBe(
        "VALIDATION_ERROR"
      );
    });

    it("is a signed-in person's act, whatever else a caller may do", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const asked = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      };
      const key = apiKeyScope([
        { slug: "read-posts", action: "read", resource: "posts" },
        { slug: "update-posts", action: "update", resource: "posts" },
      ]);
      for (const caller of [
        {},
        { overrideAccess: true },
        { ...ANN, overrideAccess: true },
        // A key whose maker is a person is the key.
        { ...ANN, authenticatedScope: key },
      ] as DocumentCaller[]) {
        expect(await refusalOf(keepCurrent(post, caller, asked))).toBe(
          "FORBIDDEN"
        );
      }
      expect((await recordsOf())[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
      // The control: the same request, made by the person.
      await keepCurrent(post, ANN, asked);
    });

    it("is asked through the Direct API as the person it names, and never as trusted code", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      const { translations } = t!.nextly as unknown as Nextly;
      const named = { collection: "posts", id: post.id, ...inSpanish() };
      const shown = await translations.sourceChange(named);
      expect(shown).toMatchObject({ available: true, before: "Hi" });
      const asked = {
        ...named,
        valueFingerprint: shown.valueFingerprint ?? "",
        sourceFingerprint: shown.sourceFingerprint ?? "",
      };
      expect(await refusalOf(translations.keepCurrent(asked))).toBe(
        "FORBIDDEN"
      );
      expect(
        await translations.keepCurrent({
          ...asked,
          overrideAccess: false,
          user: { id: "ann" },
        })
      ).toMatchObject({ item: inSpanish() });
      expect((await recordsOf())[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hello")
      );
    });

    it("is made over REST by a person whose rule matches the entry, and by no other", async () => {
      await boot(dialect);
      const own = await entry("owned", { title: "Hi", owner: "ann" });
      const others = await entry("owned", { title: "Hi", owner: "ben" });
      for (const document of [own, others]) {
        await save(document, "es", { title: "Hola" });
        await save(document, "en", { title: "Hello" });
      }
      const body = {
        ...inSpanish(),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hello"),
      };
      expect(
        (await rest("POST", entryPath(others, "keep-current"), "", body)).status
      ).toBe(404);
      const kept = await rest("POST", entryPath(own, "keep-current"), "", body);
      expect(kept.status, JSON.stringify(kept.data)).toBe(200);
      const made = (await recordsOf()).map(row => [
        row.entryId,
        row.sourceFingerprint,
      ]);
      expect(made).toContainEqual([own.id, valueFingerprint("Hello")]);
      expect(made).toContainEqual([others.id, valueFingerprint("Hi")]);
    });

    it("is made over REST where the rule admits the body's language alone, and in no other", async () => {
      await boot(dialect);
      const post = await entry("spanish", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await save(post, "fr", { title: "Salut" });
      await save(post, "en", { title: "Hello" });
      const body = (locale: string, value: string) => ({
        locale,
        field: "title",
        valueFingerprint: valueFingerprint(value),
        sourceFingerprint: valueFingerprint("Hello"),
      });
      const path = entryPath(post, "keep-current");
      const kept = await rest("POST", path, "", body("es", "Hola"));
      expect(kept.status, JSON.stringify(kept.data)).toBe(200);
      // Admitted at the gate for Spanish, and refused French behind it.
      expect((await rest("POST", path, "", body("fr", "Salut"))).status).toBe(
        404
      );
    });

    it("is refused where the entry leaves the rule's filter before its row is held", async () => {
      await boot(dialect);
      const post = await entry("owned", { title: "Hi", owner: "ann" });
      await save(post, "es", { title: "Hola" });
      await save(post, "en", { title: "Hello" });
      // Given to Ben in the transaction that locks it: what a write committed just before the lock
      // leaves behind, which a check made before it has not seen.
      let given = 0;
      whenLocked("dc_owned", tx => {
        given += 1;
        return tx.update(
          "dc_owned",
          { owner: "ben" },
          { and: [{ column: "id", op: "=", value: post.id }] }
        );
      });
      expect(
        await refusalOf(
          keepCurrent(post, ANN, {
            ...inSpanish(),
            valueFingerprint: valueFingerprint("Hola"),
            sourceFingerprint: valueFingerprint("Hello"),
          })
        )
      ).toBe("NOT_FOUND");
      expect(given).toBe(1);
      expect((await recordsOf())[0]?.sourceFingerprint).toBe(
        valueFingerprint("Hi")
      );
    });

    it("is refused where the value was made from another language before its row is held", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      // The same text in both, so no fingerprint tells one source from the other.
      await save(post, "en", { title: "Hello" });
      await save(post, "fr", { title: "Hello" });
      whenLocked("dc_posts", tx =>
        tx.update(
          "nextly_translation_provenance",
          { sourceLocale: "fr" },
          { and: [{ column: "locale", op: "=", value: "es" }] }
        )
      );
      expect(
        await refusalOf(
          keepCurrent(post, ANN, {
            ...inSpanish(),
            valueFingerprint: valueFingerprint("Hola"),
            sourceFingerprint: valueFingerprint("Hello"),
          })
        )
      ).toBe("CONFLICT");
    });

    it("is refused where its source is in a language the site no longer has", async () => {
      await boot(dialect);
      const post = await entry("posts", { title: "Hi" });
      await save(post, "es", { title: "Hola" });
      await madeFrom("de");
      // What that language's own value was is still recorded.
      await t!.adapter.update(
        "nextly_translation_provenance",
        { locale: "de" },
        { and: [{ column: "locale", op: "=", value: "en" }] }
      );
      expect(
        await refusalOf(
          keepCurrent(post, ANN, {
            ...inSpanish(),
            valueFingerprint: valueFingerprint("Hola"),
            sourceFingerprint: valueFingerprint("Hi"),
          })
        )
      ).toBe("VALIDATION_ERROR");
      expect((await recordsOf())[0]?.sourceLocale).toBe("de");
    });

    it("is refused where the held draft cleared the value, and leaves the live one out of date", async () => {
      await boot(dialect);
      const note = await clearedInDraft();
      expect(
        await refusalOf(
          keepCurrent(note, ANN, {
            ...inSpanish(),
            valueFingerprint: valueFingerprint("Hola"),
            sourceFingerprint: valueFingerprint("Hello"),
          })
        )
      ).toBe("VALIDATION_ERROR");
      expect((await recordsOf()).map(row => row.sourceFingerprint)).toEqual([
        valueFingerprint("Hi"),
      ]);
    });

    it("gives a live value written originally no source, though a held draft has the same text", async () => {
      await boot(dialect);
      const note = await entry("notes", { title: "Hi" });
      await save(note, "en", { status: "published" });
      await save(note, "es", {
        title: "Hola",
        status: "published",
        _provenance: { title: { origin: "original" } },
      });
      await save(note, "es", {
        title: "Hola",
        _provenance: { title: { origin: "machine", engine: "deepl" } },
      });
      expect((await recordsOf()).map(row => row.origin)).toEqual([
        "original",
        "machine",
      ]);
      await save(note, "en", { title: "Hello" });
      await save(note, "en", { status: "published" });

      await keepShown(note);
      expect(
        (await recordsOf()).map(row => [row.origin, row.sourceFingerprint])
      ).toEqual([
        ["original", null],
        ["machine", valueFingerprint("Hello")],
      ]);
    });

    it("needs the right to change the field in the translation's language, and to read its source", async () => {
      await boot(dialect);
      const all = { title: "Hi", locked: "Hi", sourceHidden: "Hi" };
      const post = await entry("posts", all);
      await save(post, "es", {
        title: "Hola",
        locked: "Hola",
        sourceHidden: "Hola",
      });
      const guarded = await entry("guarded", { title: "Hi" });
      await save(guarded, "es", { title: "Hola" });
      const asked = (field: string) => ({
        ...inSpanish(field),
        valueFingerprint: valueFingerprint("Hola"),
        sourceFingerprint: valueFingerprint("Hi"),
      });
      const fields = ["title", "locked", "sourceHidden"];
      const allRecords = async () =>
        (await Promise.all(fields.map(recordsOf)))
          .flat()
          .sort((a, b) => a.id.localeCompare(b.id));
      const recorded = await allRecords();
      expect(
        recorded.map(row => `${row.entryId} ${row.fieldPath}`).sort()
      ).toEqual(
        [
          ...fields.map(field => `${post.id} ${field}`),
          `${guarded.id} title`,
        ].sort()
      );

      // A field rule refuses the field, where a save would leave it out and succeed.
      expect(await refusalOf(keepCurrent(post, ANN, asked("locked")))).toBe(
        "FORBIDDEN"
      );
      // May read, and update nothing.
      expect(await refusalOf(keepCurrent(post, BEN, asked("title")))).toBe(
        "NOT_FOUND"
      );
      // The collection's own rule refuses this language alone.
      expect(await refusalOf(keepCurrent(guarded, ANN, asked("title")))).toBe(
        "NOT_FOUND"
      );
      expect(
        await refusalOf(keepCurrent(post, ANN, asked("sourceHidden")))
      ).toBe("NOT_FOUND");
      expect(await allRecords()).toEqual(recorded);
    });
  }
);
