/**
 * A container is saved whole, and a person is served it without what they may not read. Saving back
 * what they read keeps those values: in a repeater's rows, a group and a field group held inside a
 * row, on a collection and a Single, translated and not, in each language, and over a held change.
 *
 * The plausible broken implementations store the container as sent, which deletes the hidden value;
 * put a hidden value on the row at its place rather than on its own; put back what the writer could
 * see and left out; or refuse a value they may write and not read.
 *
 * @module domains/collections/__tests__/keep-unread-container-values.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  password,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { VersionsRepository } from "../../versions/versions-repository";

perLanguageStorageSuite();

type Doc = Record<string, unknown>;
type Row = Doc & { id: string };
type Result = {
  success: boolean;
  statusCode?: number;
  message?: string;
  data?: Doc | null;
};

let t: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await t?.destroy();
  t = undefined;
});

const ANN = { id: "ann", email: "ann@x.test", roles: [] };
/** Hidden from Ann, and from everyone but trusted code. */
const hidden = { read: () => false };
/** Shown where the value beside it is "public". */
const shownWhenPublic = ({ data }: { data?: Record<string, unknown> }) =>
  data?.visibility === "public";

/** The containers under test: each with a field Ann sees and one she does not. */
const containers = () => [
  text({ name: "title" }),
  repeater({
    name: "sections",
    fields: [
      text({ name: "label" }),
      text({ name: "secret", access: hidden }),
      fieldGroup({ name: "badge", component: "badge" }),
    ],
  }),
  group({
    name: "meta",
    fields: [text({ name: "note" }), text({ name: "secret", access: hidden })],
  }),
];

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const open = { read: () => true, create: () => true, update: () => true };
  t = await createTestNextly({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    fieldGroups: [
      defineFieldGroup({
        slug: "badge",
        fields: [
          text({ name: "name" }),
          text({ name: "secret", access: hidden }),
        ],
      }),
      // A group its readers are shown by a value beside it, on the instance's own row.
      defineFieldGroup({
        slug: "card",
        fields: [
          text({ name: "visibility" }),
          group({
            name: "info",
            access: { read: shownWhenPublic },
            fields: [text({ name: "note" }), text({ name: "extra" })],
          }),
          // Something hidden inside a container, so a save of it asks what its writer may read.
          group({
            name: "vault",
            fields: [text({ name: "secret", access: hidden })],
          }),
        ],
      }),
    ],
    collections: [
      defineCollection({ slug: "notices", access: open, fields: containers() }),
      defineCollection({
        slug: "stories",
        localized: true,
        access: open,
        fields: containers(),
      }),
      defineCollection({
        slug: "drafted",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: open,
        fields: containers(),
      }),
      // A value hidden by the one beside it.
      defineCollection({
        slug: "gated",
        access: open,
        fields: [
          group({
            name: "card",
            fields: [
              text({ name: "visibility" }),
              text({ name: "secret", access: { read: shownWhenPublic } }),
            ],
          }),
          fieldGroup({ name: "badge", component: "card" }),
        ],
      }),
      // Keeps drafts but can't hold one: a password field takes it out of them.
      defineCollection({
        slug: "unheld",
        status: true,
        versions: { drafts: true },
        access: open,
        fields: [...containers(), password({ name: "pin" })],
      }),
      // Nothing in it is hidden from anyone.
      defineCollection({
        slug: "plain",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: open,
        fields: [
          repeater({ name: "sections", fields: [text({ name: "label" })] }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        access: { read: () => true, update: () => true },
        fields: containers(),
      }),
      defineSingle({
        slug: "header",
        localized: true,
        access: { read: () => true, update: () => true },
        fields: containers(),
      }),
      // Keeps drafts but can't hold one, as the collection `unheld`.
      defineSingle({
        slug: "footer",
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [...containers(), password({ name: "pin" })],
      }),
    ],
  } as never);
  expect(t.adapter.dialect).toBe(dialect);
  const slugs = [
    "notices",
    "stories",
    "drafted",
    "plain",
    "banner",
    "header",
    "gated",
    "unheld",
    "footer",
  ];
  await userWhoMay(t, ANN.id, "read", slugs);
  await grantTo(t, ANN.id, "update", slugs);
  return t;
}

/** Where a document is saved and read: an entry, or a Single. */
interface Door {
  save(data: Doc, locale: string | undefined, who?: typeof ANN): Promise<Doc>;
  read(locale: string | undefined, who?: typeof ANN): Promise<Doc>;
}

/** `result`'s document, or the test's failure. */
function documentOf(result: Result): Doc {
  if (!result.success || !result.data) {
    throw new Error(`refused: ${JSON.stringify(result)}`);
  }
  return result.data;
}

const as = (who: typeof ANN | undefined) =>
  who ? { user: who, overrideAccess: false } : { overrideAccess: true };
const inLanguage = (locale: string | undefined) =>
  locale === undefined ? {} : { locale, fallbackLocale: false };

async function entryDoor(
  slug: string,
  data: Doc
): Promise<Door & { publish(locale: string): Promise<void> }> {
  const handler = t!.getService("collectionsHandler") as CollectionsHandler;
  const created = documentOf(
    (await handler.createEntry(
      { collectionName: slug, overrideAccess: true } as never,
      data
    )) as Result
  );
  const entry = { collectionName: slug, entryId: String(created.id) };
  return {
    publish: async locale => {
      documentOf(
        (await handler.publishParts(
          {
            ...entry,
            overrideAccess: true,
            data: { _overwrite: true },
          } as never,
          { direction: "publish", locales: [locale], shared: true } as never
        )) as Result
      );
    },
    save: async (values, locale, who) =>
      documentOf(
        (await handler.updateEntry(
          { ...entry, ...as(who), ...inLanguage(locale) } as never,
          { ...values, _overwrite: true }
        )) as Result
      ),
    read: async (locale, who) =>
      documentOf(
        (await handler.getEntry({
          ...entry,
          ...as(who),
          ...inLanguage(locale),
          status: "all",
          includeWorkingDraft: true,
          depth: 0,
        } as never)) as Result
      ),
  };
}

async function singleDoor(slug: string, data: Doc): Promise<Door> {
  const singles = t!.getService(
    "singleEntryService"
  ) as unknown as SingleEntryService;
  const door: Door = {
    save: async (values, locale, who) =>
      documentOf(
        (await singles.update(slug, { ...values, _overwrite: true }, {
          ...as(who),
          ...inLanguage(locale),
        } as never)) as unknown as Result
      ),
    read: async (locale, who) =>
      documentOf(
        (await singles.get(slug, {
          ...as(who),
          ...inLanguage(locale),
          status: "all",
          includeWorkingDraft: true,
          depth: 0,
        } as never)) as unknown as Result
      ),
  };
  await door.save(data, undefined);
  return door;
}

/** The containers' values, marked with where they were written. */
const values = (tag: string): Doc => ({
  title: tag,
  sections: ["a", "b"].map(id => ({
    id,
    label: `${id} ${tag}`,
    secret: `${id} secret ${tag}`,
    badge: { name: `${id} ${tag}`, secret: `${id} badge ${tag}` },
  })),
  meta: { note: tag, secret: `meta ${tag}` },
});

const rowsOf = (document: Doc) => document.sections as Row[];
const rowOf = (document: Doc, id: string) =>
  rowsOf(document).find(row => row.id === id) as Row;

/** What Ann reads, checked to lack every hidden value, or the rest of a test proves nothing. */
async function readByAnn(door: Door, locale?: string): Promise<Doc> {
  const read = await door.read(locale, ANN);
  expect(JSON.stringify(read)).not.toMatch(/secret|badge (en|es)/);
  expect(rowsOf(read).map(row => row.id)).toEqual(["a", "b"]);
  return read;
}

/** Ann saves back what she read, with a change of hers in each container. */
async function saveOwnChange(
  door: Door,
  read: Doc,
  locale?: string
): Promise<void> {
  const [a, b] = rowsOf(read);
  await door.save(
    {
      sections: [
        { ...b, label: "b Ann" },
        {
          ...a,
          label: "a Ann",
          badge: { ...(a?.badge as Doc), name: "a Ann" },
        },
      ],
      meta: { ...(read.meta as Doc), note: "Ann" },
    },
    locale,
    ANN
  );
}

/** Ann's change is stored, and each hidden value is where it was, as `tag` wrote it. */
function expectKept(stored: Doc, tag: string): void {
  expect(rowsOf(stored).map(row => row.id)).toEqual(["b", "a"]);
  for (const id of ["a", "b"]) {
    expect(rowOf(stored, id)).toMatchObject({
      label: `${id} Ann`,
      secret: `${id} secret ${tag}`,
      badge: { secret: `${id} badge ${tag}` },
    });
  }
  expect((rowOf(stored, "a").badge as Doc).name).toBe("a Ann");
  expect(stored.meta).toMatchObject({ note: "Ann", secret: `meta ${tag}` });
}

/** Each document a save goes through, by its door. */
const DOORS = [
  ["a collection", (data: Doc) => entryDoor("notices", data), undefined],
  [
    "a translated collection, in the default language",
    (data: Doc) => entryDoor("stories", data),
    "en",
  ],
  [
    "a translated collection, in another language",
    (data: Doc) => entryDoor("stories", data),
    "es",
  ],
  ["a Single", (data: Doc) => singleDoor("banner", data), undefined],
  [
    "a translated Single, in the default language",
    (data: Doc) => singleDoor("header", data),
    "en",
  ],
  [
    "a translated Single, in another language",
    (data: Doc) => singleDoor("header", data),
    "es",
  ],
] as const;

describe.each(getConfiguredTestDialects())(
  "a save keeps what its writer may not read inside a container (%s)",
  dialect => {
    it.each(DOORS)("of %s", async (_name, openDoor, locale) => {
      await boot(dialect);
      const door = await openDoor(values("en"));
      if (locale === "es") await door.save(values("es"), "es");
      const tag = locale ?? "en";

      const read = await readByAnn(door, locale);
      await saveOwnChange(door, read, locale);
      expectKept(await door.read(locale), tag);

      // The other language's own are as they were.
      if (locale !== "es") return;
      const english = await door.read("en");
      for (const id of ["a", "b"]) {
        expect(rowOf(english, id).secret).toBe(`${id} secret en`);
      }
    });

    it.each([
      ["a collection", (data: Doc) => entryDoor("notices", data)],
      ["a Single", (data: Doc) => singleDoor("banner", data)],
    ] as const)(
      "of %s, for the rows the save keeps, and moves none to another",
      async (_name, openDoor) => {
        await boot(dialect);
        const door = await openDoor(values("en"));
        const [, b] = rowsOf(await readByAnn(door));
        // The first row goes, with what it held; a new one is put in its place.
        await door.save({ sections: [{ label: "new" }, b] }, undefined, ANN);

        const stored = rowsOf(await door.read(undefined));
        expect(stored).toHaveLength(2);
        expect(stored[0]).toMatchObject({ label: "new" });
        expect(stored[0]?.secret ?? null).toBeNull();
        expect(stored[1]).toMatchObject({ id: "b", secret: "b secret en" });
        expect(JSON.stringify(stored)).not.toContain("a secret");
      }
    );

    it.each([
      ["a collection", (data: Doc) => entryDoor("notices", data)],
      ["a Single", (data: Doc) => singleDoor("banner", data)],
    ] as const)(
      "of %s, and stores a value they send there",
      async (_name, openDoor) => {
        await boot(dialect);
        const door = await openDoor(values("en"));
        const read = await readByAnn(door);
        const [a, b] = rowsOf(read);
        await door.save(
          {
            sections: [{ ...a, secret: "Ann's" }, b],
            meta: { note: "Ann", secret: null },
          },
          undefined,
          ANN
        );
        const stored = await door.read(undefined);
        expect(rowOf(stored, "a").secret).toBe("Ann's");
        expect(rowOf(stored, "b").secret).toBe("b secret en");
        expect((stored.meta as Doc).secret).toBeNull();
      }
    );

    it("removes what its writer could read and left out", async () => {
      await boot(dialect);
      const door = await entryDoor("notices", values("en"));
      const read = await readByAnn(door);
      const { label: _label, ...a } = rowsOf(read)[0] as Row;
      await door.save({ sections: [a] }, undefined, ANN);
      const [stored] = rowsOf(await door.read(undefined));
      expect(stored?.label ?? null).toBeNull();
      expect(stored?.secret).toBe("a secret en");
    });

    it("over a held change, as that change has it, and as it goes live", async () => {
      await boot(dialect);
      const door = await entryDoor("drafted", {
        ...values("en"),
        status: "published",
      });
      // Held by another writer: a value changed, and a row added.
      const held = values("held");
      await door.save(
        {
          sections: [
            ...rowsOf(held),
            { id: "p", label: "p held", secret: "p secret held" },
          ],
          meta: held.meta,
        },
        "en"
      );
      const read = await door.read("en", ANN);
      expect(rowsOf(read).map(row => row.id)).toEqual(["a", "b", "p"]);
      expect(JSON.stringify(read)).not.toContain("secret");

      await door.save(
        {
          sections: rowsOf(read).map(row => ({
            ...row,
            label: `${row.id} Ann`,
          })),
          meta: { ...(read.meta as Doc), note: "Ann" },
        },
        "en",
        ANN
      );
      const expectHeld = (document: Doc) => {
        for (const id of ["a", "b", "p"]) {
          expect(rowOf(document, id)).toMatchObject({
            label: `${id} Ann`,
            secret: `${id} secret held`,
          });
        }
        expect(document.meta).toMatchObject({
          note: "Ann",
          secret: "meta held",
        });
      };
      expectHeld(await door.read("en"));

      await door.publish("en");
      expectHeld(await door.read("en"));
    });

    it("reads nothing more for trusted code, or where nothing is hidden", async () => {
      await boot(dialect);
      const hiding = await entryDoor("drafted", values("en"));
      const plain = await entryDoor("plain", {
        sections: [{ id: "a", label: "a" }],
      });
      const pending = vi.spyOn(
        VersionsRepository.prototype,
        "findWorkingDraft"
      );
      /** How often a save reads the pending change off its own transaction's connection. */
      const pendingReads = async (work: () => Promise<unknown>) => {
        pending.mockClear();
        await work();
        return pending.mock.contexts.filter(
          repo => (repo as unknown as { db: unknown }).db === t!.adapter
        ).length;
      };
      const edit = { sections: [{ id: "a", label: "b" }] };
      const trusted = await pendingReads(() => hiding.save(values("en"), "en"));
      const unhidden = await pendingReads(() => plain.save(edit, "en", ANN));
      expect([trusted, unhidden]).toEqual([0, 0]);
      // The control: a save by someone the rules hide from does read it.
      expect(
        await pendingReads(() =>
          hiding.save({ meta: { note: "n" } }, "en", ANN)
        )
      ).toBeGreaterThan(0);
    });

    // Broken by judging what Ann may read on the document as her save leaves it.
    it("keeps a value hidden by the one beside it, which her save shows", async () => {
      await boot(dialect);
      const door = await entryDoor("gated", {
        card: { visibility: "private", secret: "s" },
      });
      const read = await door.read(undefined, ANN);
      expect(read.card).toEqual({ visibility: "private" });

      await door.save({ card: { visibility: "public" } }, undefined, ANN);

      expect((await door.read(undefined)).card).toEqual({
        visibility: "public",
        secret: "s",
      });
    });

    // Broken by knowing a row only by an id that is a non-empty string.
    it.each([
      [
        "no ids",
        [
          { label: "x", secret: "s" },
          { label: "y", secret: "t" },
        ],
      ],
      [
        "ids that are numbers",
        [
          { id: 7, label: "x", secret: "s" },
          { id: 8, label: "y", secret: "t" },
        ],
      ],
    ] as const)("keeps it in rows stored with %s", async (_name, stored) => {
      await boot(dialect);
      const door = await entryDoor("notices", values("en"));
      // Rows as an older release, or a field of the author's called `id`, stored them.
      const [row] = await t!.adapter.select<{ id: string }>("dc_notices", {});
      await t!.adapter.update(
        "dc_notices",
        { sections: JSON.stringify(stored) },
        { and: [{ column: "id", op: "=", value: row!.id }] }
      );
      const read = rowsOf(await door.read(undefined, ANN));
      expect(JSON.stringify(read)).not.toContain("secret");

      await door.save(
        { sections: read.map(each => ({ ...each, label: "Ann" })) },
        undefined,
        ANN
      );

      const now = rowsOf(await door.read(undefined));
      expect(now.map(each => [each.label, each.secret])).toEqual([
        ["Ann", "s"],
        ["Ann", "t"],
      ]);
    });

    // Broken by laying a pending change no read shows over what Ann saves.
    it.each([
      ["an entry", "collection", () => entryDoor("unheld", values("en"))],
      ["a Single", "single", () => singleDoor("footer", values("en"))],
    ] as const)(
      "keeps the live value of %s where a pending change can't be shown",
      async (_name, scopeKind, openDoor) => {
        await boot(dialect);
        const door = await openDoor();
        const { id } = await door.read(undefined);
        // A pending change it can't hold, left from before, which no read shows: its shared part,
        // and the text it holds in the language saved.
        for (const locale of [null, "en"]) {
          await new VersionsRepository(t!.adapter).upsertWorkingDraft({
            ref: {
              scopeKind,
              scopeSlug: scopeKind === "single" ? "footer" : "unheld",
              entryId: String(id),
            },
            locale,
            snapshot: { meta: { note: "stale", secret: "stale" } },
          });
        }
        const read = await door.read(undefined, ANN);
        expect(read.meta).toEqual({ note: "en" });

        await door.save({ meta: { note: "Ann" } }, undefined, ANN);

        expect((await door.read(undefined)).meta).toEqual({
          note: "Ann",
          secret: "meta en",
        });
      }
    );

    // Broken by judging a field group's read rules on its containers alone.
    it("judges what Ann may read of a field group on the whole instance", async () => {
      await boot(dialect);
      const door = await entryDoor("gated", {
        badge: { visibility: "public", info: { note: "n", extra: "e" } },
      });
      const read = await door.read(undefined, ANN);
      expect(read.badge).toMatchObject({ info: { note: "n", extra: "e" } });

      // Ann clears what she could see, sending the instance's group alone: its value beside
      // the group, which shows it, stays as stored.
      await door.save(
        { badge: { id: (read.badge as Doc).id, info: { note: "Ann" } } },
        undefined,
        ANN
      );

      const info = ((await door.read(undefined)).badge as Doc).info as Doc;
      expect(info.note).toBe("Ann");
      expect(info.extra ?? null).toBeNull();
    });
  }
);
