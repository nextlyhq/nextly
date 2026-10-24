/**
 * Field rules on fields inside a field group decide them on every write, as a
 * collection's own field rules decide its fields.
 *
 * The field group `note` carries two guarded fields:
 * - `locked`, writable only by the allowed person (a function rule);
 * - `sealed`, never writable (`create` and `update` false).
 * It sits in every shape a field group takes that is stored: single,
 * repeatable, a dynamic zone, and inside a group field. The collection carries
 * the same rules on fields of its own, at the top level and nested in a group
 * and in a group inside that group.
 *
 * Every write is made by an editor who may create, update and publish, through
 * each door a write reaches the store by: REST and the checked Direct API, a
 * write inside a caller's transaction, a bulk create, a Single, the publish of
 * a held draft and the restore of a version. On create a denied field is not
 * stored. On update it keeps its stored value: an instance sent with its id is
 * that instance, judged as an update, while one sent without is a new instance,
 * judged as a create. The allowed person and trusted server code are the
 * controls.
 *
 * The field group `card` holds the field group `chip` inline, in a group;
 * `chip`'s `stamp` may be set on a new instance but changed only by the
 * allowed person. An inline instance is created with the instance it is held
 * in, so a new `card` sent in an update creates its `chip` too.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  repeater,
  text,
} from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { restoreVersion } from "../../versions/restore-version";
import { writeFieldGroupType } from "../storage/field-group-type-key";

type Doc = Record<string, unknown>;

const ALLOWED = "allowed@example.com";
const onlyAllowed = ({ user }: { user: unknown }) =>
  (user as { email?: string } | null)?.email === ALLOWED;

/**
 * Writable by a caller holding `publish-board`: the editors' role does, and a
 * key they own scoped without it does not, so it tells the key's grants from
 * its owner's.
 */
const holdsPublishBoard = ({
  permissions,
}: {
  permissions?: readonly string[];
}) => permissions?.includes("publish-board") === true;

/** The guarded fields a field group and the collection itself carry. */
const guarded = () => [
  text({
    name: "locked",
    access: { create: onlyAllowed, update: onlyAllowed },
  }),
  text({ name: "sealed", access: { create: false, update: false } }),
];

/**
 * A field writable on update only by a judgment told the instance's id, so a
 * test can see whether a judgment was told the stored instance's id or
 * nothing at all.
 */
const needsId = () =>
  text({
    name: "owned",
    access: { update: ({ id }) => typeof id === "string" },
  });

/**
 * A group whose `gated` value may be written only while its own `mode` is
 * open: a rule that reads a sibling, so an update changing that sibling
 * changes the answer.
 */
const gateGroup = () =>
  group({
    name: "gate",
    fields: [
      text({ name: "mode" }),
      text({
        name: "gated",
        access: { update: ({ data }) => data?.mode !== "closed" },
      }),
    ],
  });

/** Values for both guarded fields, marked with where they were written. */
function guardedValues(tag: string): Doc {
  return { locked: `locked-${tag}`, sealed: `sealed-${tag}` };
}

function typed(type: string, data: Doc): Doc {
  const instance: Doc = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

/** A `card` instance whose inline `chip` carries a stamp marked with `tag`. */
function card(tag: string): Doc {
  return { heading: `h-${tag}`, wrap: { held: chip(tag) } };
}

function chip(tag: string): Doc {
  return { heading: "c", stamp: `stamp-${tag}` };
}

/** The stamp each `card` instance in `value` holds inline. */
function stamps(value: unknown): unknown[] {
  return list(value).map(
    instance => list(list(instance.wrap)[0]?.held)[0]?.stamp ?? null
  );
}

/** The collection's own group, and the group inside it, with guarded fields. */
function metaValues(tag: string): Doc {
  return {
    ...guardedValues(`${tag}-meta`),
    deep: guardedValues(`${tag}-deep`),
  };
}

/** A page carrying the field group in every shape, and guarded fields of its own. */
function pageData(tag: string): Doc {
  return {
    title: `page-${tag}`,
    ...guardedValues(`${tag}-top`),
    meta: metaValues(tag),
    one: { heading: "h", ...guardedValues(`${tag}-one`) },
    many: [
      { heading: "h", ...guardedValues(`${tag}-many0`) },
      { heading: "h", ...guardedValues(`${tag}-many1`) },
    ],
    zone: [
      typed("note", { heading: "h", ...guardedValues(`${tag}-zone`) }),
      typed("quote", { line: "q" }),
    ],
    box: { inBox: { heading: "h", ...guardedValues(`${tag}-box`) } },
  };
}

function list(value: unknown): Doc[] {
  return (Array.isArray(value) ? value : value ? [value] : []) as Doc[];
}

/** Every place a `note` instance sits in a stored page, in a fixed order. */
function noteInstances(doc: Doc): Doc[] {
  return [
    ...list(doc.one),
    ...list(doc.many),
    ...list(doc.zone).filter(row => "heading" in row),
    ...list(list(doc.box)[0]?.inBox),
  ];
}

/** What a guarded key holds in every note instance of `doc`. */
function inNotes(doc: Doc, key: "locked" | "sealed"): unknown[] {
  return noteInstances(doc).map(note => note[key] ?? null);
}

/** What a guarded key holds in the collection's own group and inner group. */
function inMeta(doc: Doc, key: "locked" | "sealed"): unknown[] {
  const meta = (doc.meta ?? {}) as Doc;
  const deep = (meta.deep ?? {}) as Doc;
  return [meta[key] ?? null, deep[key] ?? null];
}

/**
 * The editor's update of a stored page: every instance it held, sent back
 * with its id and every value changed, and one new repeatable instance.
 */
function changedFrom(stored: Doc, tag: string): Doc {
  const change = (instance: Doc): Doc => ({
    ...instance,
    heading: `h-${tag}`,
    ...guardedValues(`${tag}-changed`),
  });
  const box = list(stored.box)[0] ?? {};
  return {
    title: `page-${tag}`,
    ...guardedValues(`${tag}-top`),
    meta: metaValues(`${tag}-changed`),
    one: change(list(stored.one)[0]!),
    many: [
      ...list(stored.many).map(change),
      { heading: "h-new", ...guardedValues(`${tag}-new`) },
    ],
    zone: list(stored.zone).map(row => ("heading" in row ? change(row) : row)),
    box: { ...box, inBox: change(list(box.inBox)[0]!) },
  };
}

describe.each(getConfiguredTestDialects())(
  "field rules inside field groups, on writes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let editorId: string;
    let allowedId: string;
    const cookies: Record<"editor" | "allowed", string> = {
      editor: "",
      allowed: "",
    };

    async function session(userId: string, email: string, roleIds: string[]) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email,
          name: email,
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return `nextly_session=${token}`;
    }

    function rest(
      who: "editor" | "allowed",
      method: "POST" | "PATCH",
      path: string[],
      body: unknown
    ) {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      return handlers[method]!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: { cookie: cookies[who], "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    function checkedAs(who: "editor" | "allowed"): Nextly {
      return who === "editor"
        ? new Nextly({ overrideAccess: false, user: { id: editorId } })
        : new Nextly({
            overrideAccess: false,
            user: { id: allowedId, email: ALLOWED },
          });
    }

    /** The caller context the collection service's own entry points take. */
    function serviceContext(who: "editor" | "allowed"): Doc {
      return who === "editor"
        ? { user: { id: editorId }, overrideAccess: false }
        : { user: { id: allowedId, email: ALLOWED }, overrideAccess: false };
    }

    interface CollectionService {
      withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
      createEntryInTransaction: (
        tx: unknown,
        slug: string,
        data: Doc,
        ctx: Doc
      ) => Promise<Doc>;
      updateEntryInTransaction: (
        tx: unknown,
        slug: string,
        id: string,
        data: Doc,
        ctx: Doc
      ) => Promise<Doc>;
      createMany: (
        slug: string,
        rows: Doc[],
        ctx: Doc
      ) => Promise<{ ids: string[]; failed: number }>;
    }
    const service = () =>
      t.getService("collectionService") as unknown as CollectionService;

    async function stored(collection: string, id: string): Promise<Doc> {
      return (await trusted.findByID({
        collection,
        id,
        depth: 1,
      } as never)) as Doc;
    }

    /** A page written by trusted code, its guarded values all set. */
    async function seeded(tag: string, collection = "pages"): Promise<string> {
      const { item } = await trusted.create({
        collection,
        data: pageData(tag),
      } as never);
      return String(item.id);
    }

    /** What a create through `door` stores, as the editor. */
    async function createAs(
      door: "rest" | "direct" | "transaction" | "bulk",
      who: "editor" | "allowed",
      data: Doc
    ): Promise<string> {
      if (door === "rest") {
        const res = await rest(
          who,
          "POST",
          ["collections", "pages", "entries"],
          data
        );
        expect(res.status).toBe(201);
        return ((await res.json()) as { item: { id: string } }).item.id;
      }
      if (door === "direct") {
        const created = await checkedAs(who).create({
          collection: "pages",
          data,
        } as never);
        return String(created.item.id);
      }
      if (door === "transaction") {
        const created = await service().withTransaction(tx =>
          service().createEntryInTransaction(
            tx,
            "pages",
            data,
            serviceContext(who)
          )
        );
        return String(created.id);
      }
      const result = await service().createMany(
        "pages",
        [data],
        serviceContext(who)
      );
      expect(result.failed).toBe(0);
      return String(result.ids[0]);
    }

    /** An update through `door`, as `who`. */
    async function updateAs(
      door: "rest" | "direct" | "transaction",
      who: "editor" | "allowed",
      id: string,
      data: Doc
    ): Promise<void> {
      if (door === "rest") {
        const res = await rest(
          who,
          "PATCH",
          ["collections", "pages", "entries", id],
          data
        );
        expect(res.status).toBe(200);
        return;
      }
      if (door === "direct") {
        await checkedAs(who).update({
          collection: "pages",
          id,
          data,
        } as never);
        return;
      }
      await service().withTransaction(tx =>
        service().updateEntryInTransaction(
          tx,
          "pages",
          id,
          data,
          serviceContext(who)
        )
      );
    }

    /** An update of an entry of `collection` through REST or the checked Direct API. */
    async function updateIn(
      collection: string,
      door: "rest" | "direct",
      who: "editor" | "allowed",
      id: string,
      data: Doc
    ): Promise<void> {
      if (door === "rest") {
        const res = await rest(
          who,
          "PATCH",
          ["collections", collection, "entries", id],
          data
        );
        expect(res.status).toBe(200);
        return;
      }
      await checkedAs(who).update({ collection, id, data } as never);
    }

    beforeAll(async () => {
      const pageFields = () => [
        text({ name: "title" }),
        ...guarded(),
        group({
          name: "meta",
          fields: [...guarded(), group({ name: "deep", fields: guarded() })],
        }),
        fieldGroup({ name: "one", component: "note" }),
        fieldGroup({ name: "many", component: "note", repeatable: true }),
        fieldGroup({
          name: "zone",
          components: ["note", "quote"],
          repeatable: true,
        }),
        // A dynamic zone holding one block, as an object rather than a list.
        fieldGroup({ name: "oneZone", components: ["note", "quote"] }),
        group({
          name: "box",
          fields: [fieldGroup({ name: "inBox", component: "note" })],
        }),
        gateGroup(),
      ];
      const singleFields = () => [
        text({ name: "title" }),
        text({
          name: "keyed",
          access: { create: holdsPublishBoard, update: holdsPublishBoard },
        }),
        group({ name: "meta", fields: [...guarded()] }),
        fieldGroup({ name: "one", component: "note" }),
      ];
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "note",
            fields: [
              text({ name: "heading" }),
              ...guarded(),
              // Never set on a new instance; any update may change it.
              text({ name: "later", access: { create: false } }),
              needsId(),
            ],
          }),
          defineFieldGroup({
            slug: "quote",
            fields: [text({ name: "line" })],
          }),
          defineFieldGroup({
            slug: "chip",
            fields: [
              text({ name: "heading" }),
              // Set freely on a new instance; changed only by the allowed person.
              text({ name: "stamp", access: { update: onlyAllowed } }),
            ],
          }),
          // A field named like one of the store's own columns, in a group
          // inside a field group: content, judged by its rule like any other.
          defineFieldGroup({
            slug: "logbook",
            fields: [
              text({ name: "heading" }),
              group({
                name: "trail",
                fields: [
                  text({ name: "updatedAt", access: { update: onlyAllowed } }),
                ],
              }),
            ],
          }),
          defineFieldGroup({
            slug: "card",
            fields: [
              text({ name: "heading" }),
              group({
                name: "wrap",
                fields: [fieldGroup({ name: "held", component: "chip" })],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({ slug: "pages", fields: pageFields() }),
          // A held draft, published by someone other than its author.
          defineCollection({
            slug: "drafted",
            status: true,
            versions: { drafts: true },
            fields: pageFields(),
          }),
          // A held draft whose only field rules are its field groups'.
          defineCollection({
            slug: "groupdrafted",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "one", component: "note" }),
            ],
          }),
          // History to restore from.
          defineCollection({
            slug: "versioned",
            versions: true,
            fields: pageFields(),
          }),
          // Field groups holding a field group inline.
          defineCollection({
            slug: "cards",
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "deck", component: "card", repeatable: true }),
              fieldGroup({ name: "solo", component: "card" }),
            ],
          }),
          defineCollection({
            slug: "logged",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "log", component: "logbook" }),
            ],
          }),
          // A repeater stored whole, in its own column, whose rows carry ids.
          defineCollection({
            slug: "rowed",
            fields: [
              text({ name: "title" }),
              repeater({
                name: "lines",
                fields: [
                  text({ name: "heading" }),
                  text({
                    name: "locked",
                    access: { create: onlyAllowed, update: onlyAllowed },
                  }),
                  text({ name: "mode" }),
                  text({
                    name: "gated",
                    access: { update: ({ data }) => data?.mode !== "closed" },
                  }),
                ],
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({ slug: "site", fields: singleFields() }),
          defineSingle({
            slug: "board",
            status: true,
            versions: { drafts: true },
            fields: singleFields(),
          }),
          defineSingle({
            slug: "ledger",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "log", component: "logbook" }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
        seedAllSinglePermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      await seeder.seedAllSinglePermissions();

      await trusted.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const perms = await trusted.permissions.find({ limit: 1000 });
      const id = (slug: string) => {
        const found = perms.items.find(p => p.slug === slug);
        expect(found, `\`${slug}\` must be seeded`).toBeDefined();
        return found!.id;
      };
      const editorRoleId = (
        await trusted.roles.create({
          data: {
            name: "editors",
            slug: "editors",
            permissionIds: [
              ...["pages", "drafted", "versioned", "cards", "rowed"].flatMap(
                slug => [`create-${slug}`, `read-${slug}`, `update-${slug}`]
              ),
              "publish-drafted",
              "create-groupdrafted",
              "read-groupdrafted",
              "update-groupdrafted",
              "publish-groupdrafted",
              "read-site",
              "update-site",
              "read-board",
              "update-board",
              "publish-board",
              "create-logged",
              "read-logged",
              "update-logged",
              "publish-logged",
              "read-ledger",
              "update-ledger",
              "publish-ledger",
            ].map(id),
          },
        })
      ).item.id;
      const make = async (email: string) =>
        String(
          (
            (
              await trusted.users.create({
                email,
                password: "Password123!",
                data: { name: email, isActive: true, roles: [editorRoleId] },
              })
            ).item as { id: string }
          ).id
        );
      editorId = await make("editor@example.com");
      allowedId = await make(ALLOWED);
      cookies.editor = await session(editorId, "editor@example.com", [
        editorRoleId,
      ]);
      cookies.allowed = await session(allowedId, ALLOWED, [editorRoleId]);
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    describe.each(["rest", "direct", "transaction", "bulk"] as const)(
      "a create through %s",
      door => {
        it("stores no field-group field the creator may not write", async () => {
          const id = await createAs(door, "editor", pageData(`c-${door}`));
          const doc = await stored("pages", id);

          expect(noteInstances(doc)).toHaveLength(5);
          expect(inNotes(doc, "locked")).toEqual([
            null,
            null,
            null,
            null,
            null,
          ]);
          expect(inNotes(doc, "sealed")).toEqual([
            null,
            null,
            null,
            null,
            null,
          ]);
          // What they may write is stored.
          expect(noteInstances(doc).every(note => note.heading === "h")).toBe(
            true
          );
          // The collection's own fields, at every depth: the control.
          expect([doc.locked ?? null, doc.sealed ?? null]).toEqual([
            null,
            null,
          ]);
          expect(inMeta(doc, "locked")).toEqual([null, null]);
        });
      }
    );

    describe.each(["rest", "direct", "transaction"] as const)(
      "an update through %s",
      door => {
        it("keeps every field-group field the updater may not write, and judges a new instance as created", async () => {
          const id = await seeded(`u-${door}`);
          const before = await stored("pages", id);

          await updateAs(door, "editor", id, changedFrom(before, `u-${door}`));
          const after = await stored("pages", id);
          const notes = noteInstances(after);

          // The five stored instances, then the new repeatable one.
          expect(notes.map(note => note.heading)).toEqual([
            `h-u-${door}`,
            `h-u-${door}`,
            `h-u-${door}`,
            "h-new",
            `h-u-${door}`,
            `h-u-${door}`,
          ]);
          const kept = (key: "locked" | "sealed") => [
            ...inNotes(before, key).slice(0, 3),
            null,
            ...inNotes(before, key).slice(3),
          ];
          expect(inNotes(after, "locked")).toEqual(kept("locked"));
          expect(inNotes(after, "sealed")).toEqual(kept("sealed"));
        });

        it("keeps the collection's own fields nested in a group and in a group inside it", async () => {
          const id = await seeded(`g-${door}`);
          const before = await stored("pages", id);

          await updateAs(door, "editor", id, changedFrom(before, `g-${door}`));
          const after = await stored("pages", id);

          expect(inMeta(after, "locked")).toEqual(inMeta(before, "locked"));
          expect(inMeta(after, "sealed")).toEqual(inMeta(before, "sealed"));
        });
      }
    );

    describe("the allowed person", () => {
      it("writes what the function rule allows, never what is false", async () => {
        const id = await createAs("direct", "allowed", pageData("a"));
        const doc = await stored("pages", id);
        expect(inNotes(doc, "locked").every(v => typeof v === "string")).toBe(
          true
        );
        expect(inNotes(doc, "sealed")).toEqual([null, null, null, null, null]);

        await updateAs("direct", "allowed", id, changedFrom(doc, "a2"));
        const after = await stored("pages", id);
        expect(inNotes(after, "locked")[0]).toBe("locked-a2-changed");
      });
    });

    describe("a field group held inline in another field group's instance", () => {
      /** A `cards` entry written by trusted code: one card in each field. */
      async function seededCards(tag: string): Promise<string> {
        const { item } = await trusted.create({
          collection: "cards",
          data: { title: tag, deck: [card(tag)], solo: card(`${tag}-solo`) },
        } as never);
        return String(item.id);
      }

      /** `instance` sent back with its inline chip's stamp changed. */
      function restamped(instance: Doc, tag: string): Doc {
        const held = list(list(instance.wrap)[0]?.held)[0] ?? {};
        return { ...instance, wrap: { held: { ...held, ...chip(tag) } } };
      }

      describe.each(["rest", "direct"] as const)("through %s", door => {
        it("creates the inline instance of a new one, and updates a stored one's", async () => {
          const id = await seededCards(`n-${door}`);
          const before = await stored("cards", id);

          await updateIn("cards", door, "editor", id, {
            deck: [
              restamped(list(before.deck)[0]!, `n-${door}-changed`),
              card(`n-${door}-new`),
            ],
          });
          const after = await stored("cards", id);

          // The stored card's chip keeps its stamp; the new card's chip is
          // new with it, so its stamp is set.
          expect(stamps(after.deck)).toEqual([
            `stamp-n-${door}`,
            `stamp-n-${door}-new`,
          ]);
        });

        it("updates a single field group's inline instance sent without its id", async () => {
          const id = await seededCards(`s-${door}`);

          // The stored instance is updated whatever id is sent, so what it
          // holds inline is updated, not created.
          await updateIn("cards", door, "editor", id, {
            solo: card(`s-${door}-changed`),
          });
          const after = await stored("cards", id);

          expect(list(after.solo)[0]?.heading).toBe(`h-s-${door}-changed`);
          expect(stamps(after.solo)).toEqual([`stamp-s-${door}-solo`]);
        });
      });

      it("lets the allowed person change a stored instance's inline child", async () => {
        const id = await seededCards("a");
        const before = await stored("cards", id);

        await updateIn("cards", "direct", "allowed", id, {
          deck: [restamped(list(before.deck)[0]!, "a-changed")],
          solo: card("a-solo-changed"),
        });
        const after = await stored("cards", id);

        expect(stamps(after.deck)).toEqual(["stamp-a-changed"]);
        expect(stamps(after.solo)).toEqual(["stamp-a-solo-changed"]);
      });
    });

    describe("a repeater stored whole, sent with a repeated row id", () => {
      async function seededRows(rows: Doc[]): Promise<string> {
        const { item } = await trusted.create({
          collection: "rowed",
          data: { title: "r", lines: rows },
        } as never);
        return String(item.id);
      }

      const rowsOf = async (id: string) =>
        list((await stored("rowed", id)).lines);

      describe.each(["rest", "direct"] as const)("through %s", door => {
        it("gives the repeated row none of the stored row's values", async () => {
          const id = await seededRows([
            { id: "r1", heading: "h", locked: `locked-${door}` },
          ]);

          // One id names one stored row: the second row sent with it is new.
          await updateIn("rowed", door, "editor", id, {
            lines: [
              { id: "r1", heading: "h2" },
              { id: "r1", heading: "copy" },
            ],
          });
          const rows = await rowsOf(id);

          expect(rows.map(row => row.heading)).toEqual(["h2", "copy"]);
          expect(rows.map(row => row.locked ?? null)).toEqual([
            `locked-${door}`,
            null,
          ]);
        });

        it("judges a row by its own siblings when another row's id repeats", async () => {
          const id = await seededRows([
            { id: "r1", mode: "open" },
            { id: "r2", mode: "closed", gated: `gated-${door}` },
          ]);

          // The closed row is sent without its child, behind a repeated id
          // that moves it off its index: it is still judged as closed.
          await updateIn("rowed", door, "editor", id, {
            lines: [
              { id: "r1", mode: "open" },
              { id: "r1", mode: "open" },
              { id: "r2", mode: "closed" },
            ],
          });
          const rows = await rowsOf(id);

          expect(rows.map(row => row.gated ?? null)).toEqual([
            null,
            null,
            `gated-${door}`,
          ]);
        });
      });

      it("lets the allowed person set the repeated row's guarded value", async () => {
        const id = await seededRows([{ id: "r1", heading: "h", locked: "l" }]);

        await updateIn("rowed", "direct", "allowed", id, {
          lines: [
            { id: "r1", heading: "h2", locked: "l2" },
            { id: "r1", heading: "copy", locked: "set" },
          ],
        });
        const rows = await rowsOf(id);

        expect(rows.map(row => row.locked ?? null)).toEqual(["l2", "set"]);
      });
    });

    describe.each(["rest", "direct"] as const)("a Single through %s", door => {
      it("keeps a field-group field, and its own nested field, its updater may not write", async () => {
        await trusted.updateSingle({
          slug: "site",
          data: {
            title: "s",
            meta: guardedValues("site-meta"),
            one: { heading: "h", ...guardedValues("site") },
          },
        } as never);
        const before = (await trusted.findSingle({
          slug: "site",
        } as never)) as Doc;
        const data = {
          title: `s-${door}`,
          meta: guardedValues(`site-meta-${door}`),
          one: {
            ...(before.one as Doc),
            heading: `h-${door}`,
            ...guardedValues(`site-${door}`),
          },
        };
        if (door === "rest") {
          const res = await rest("editor", "PATCH", ["singles", "site"], data);
          expect(res.status).toBe(200);
        } else {
          await checkedAs("editor").updateSingle({
            slug: "site",
            data,
          } as never);
        }

        const after = (await trusted.findSingle({
          slug: "site",
        } as never)) as Doc;
        const one = after.one as Doc;
        expect(after.title).toBe(`s-${door}`);
        expect(one.heading).toBe(`h-${door}`);
        expect([one.locked, one.sealed]).toEqual([
          "locked-site",
          "sealed-site",
        ]);
        const meta = after.meta as Doc;
        expect([meta.locked, meta.sealed]).toEqual([
          "locked-site-meta",
          "sealed-site-meta",
        ]);
      });
    });

    describe("a scoped API key updating a Single", () => {
      it("is judged by its own grants on the Single's own fields", async () => {
        await trusted.updateSingle({
          slug: "site",
          data: { title: "s", keyed: "stored" },
        } as never);
        // Owned by the editor, whose role holds `publish-board`; the key
        // does not.
        const asKey = new Nextly({
          overrideAccess: false,
          user: { id: editorId },
          actor: {
            actorType: "apiKey",
            permissions: ["read-site", "update-site"],
          },
        } as never);
        await asKey.updateSingle({
          slug: "site",
          data: { title: "s-key", keyed: "by-key" },
        } as never);
        const afterKey = (await trusted.findSingle({
          slug: "site",
        } as never)) as Doc;
        expect(afterKey.title).toBe("s-key");
        expect(afterKey.keyed).toBe("stored");

        // The owner, the control: the rule lets them write it.
        await checkedAs("editor").updateSingle({
          slug: "site",
          data: { keyed: "by-owner" },
        } as never);
        const afterOwner = (await trusted.findSingle({
          slug: "site",
        } as never)) as Doc;
        expect(afterOwner.keyed).toBe("by-owner");
      });
    });

    describe("the publish of a held draft", () => {
      it("is refused for a collection when the draft changes a field-group field the publisher may not write", async () => {
        const id = await seeded("p", "drafted");
        await trusted.update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);
        const live = await stored("drafted", id);
        // The allowed person's draft changes `locked`, which they may write.
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: {
            one: { ...(live.one as Doc), ...guardedValues("p-draft") },
          },
        } as never);

        await expect(
          checkedAs("editor").update({
            collection: "drafted",
            id,
            data: { status: "published" },
          } as never)
          // Refused, naming the field: the pending change edits it, and the
          // publisher may not write it. The change is kept for someone who may.
        ).rejects.toMatchObject({ statusCode: 400 });
        const after = await stored("drafted", id);
        expect((after.one as Doc).locked).toBe((live.one as Doc).locked);
      });

      it("is refused for a Single when the draft changes a field-group field the publisher may not write", async () => {
        await trusted.updateSingle({
          slug: "board",
          data: {
            title: "b",
            status: "published",
            one: { heading: "h", ...guardedValues("board") },
          },
        } as never);
        const live = (await trusted.findSingle({
          slug: "board",
        } as never)) as Doc;
        await checkedAs("allowed").updateSingle({
          slug: "board",
          data: {
            one: { ...(live.one as Doc), ...guardedValues("board-draft") },
          },
        } as never);

        await expect(
          checkedAs("editor").updateSingle({
            slug: "board",
            data: { status: "published" },
          } as never)
          // Refused, naming the field: the pending change edits it, and the
          // publisher may not write it. The change is kept for someone who may.
        ).rejects.toMatchObject({ statusCode: 400 });
        const after = (await trusted.findSingle({
          slug: "board",
        } as never)) as Doc;
        expect((after.one as Doc).locked).toBe("locked-board");
      });
    });

    describe("the publish of a field-group child named like a store column", () => {
      /** What the `log` instance's `trail.updatedAt` holds in `doc`. */
      const trailOf = (doc: Doc) =>
        list(list(list(doc.log)[0]?.trail)[0])[0]?.updatedAt ?? null;
      const logWith = (doc: Doc, value: string): Doc => ({
        ...(list(doc.log)[0] ?? {}),
        trail: { updatedAt: value },
      });

      /** A published `logged` entry whose pending change, by the allowed person, edits the child. */
      async function pendingEntry(tag: string): Promise<string> {
        const { item } = await trusted.create({
          collection: "logged",
          data: {
            title: tag,
            status: "published",
            log: { heading: "h", trail: { updatedAt: `live-${tag}` } },
          },
        } as never);
        const id = String(item.id);
        const live = await stored("logged", id);
        await checkedAs("allowed").update({
          collection: "logged",
          id,
          data: { log: logWith(live, `pending-${tag}`) },
        } as never);
        return id;
      }

      /** The `ledger` Single, published, with the same pending change. */
      async function pendingLedger(tag: string): Promise<void> {
        await trusted.updateSingle({
          slug: "ledger",
          data: {
            title: tag,
            status: "published",
            log: { heading: "h", trail: { updatedAt: `live-${tag}` } },
          },
        } as never);
        const live = (await trusted.findSingle({
          slug: "ledger",
        } as never)) as Doc;
        await checkedAs("allowed").updateSingle({
          slug: "ledger",
          data: { log: logWith(live, `pending-${tag}`) },
        } as never);
      }

      /** The status a publish through `door` answers with, as `who`. */
      async function publish(
        door: "rest" | "direct",
        who: "editor" | "allowed",
        target: { collection: string; id: string } | { single: string }
      ): Promise<number> {
        const body = { status: "published" };
        if (door === "rest") {
          const path =
            "single" in target
              ? ["singles", target.single]
              : ["collections", target.collection, "entries", target.id];
          return (await rest(who, "PATCH", path, body)).status;
        }
        try {
          if ("single" in target) {
            await checkedAs(who).updateSingle({
              slug: target.single,
              data: body,
            } as never);
          } else {
            await checkedAs(who).update({ ...target, data: body } as never);
          }
          return 200;
        } catch (error) {
          return (error as { statusCode?: number }).statusCode ?? 500;
        }
      }

      describe.each(["rest", "direct"] as const)("through %s", door => {
        it("refuses a collection's publish when the pending change edits it", async () => {
          const id = await pendingEntry(`c-${door}`);

          // The publisher may not write the child, so the pending edit is
          // refused, not dropped to the live value as if it were bookkeeping.
          expect(
            await publish(door, "editor", { collection: "logged", id })
          ).toBe(400);
          expect(trailOf(await stored("logged", id))).toBe(`live-c-${door}`);
          const draft = (await trusted.findByID({
            collection: "logged",
            id,
            depth: 1,
            draft: true,
          } as never)) as Doc;
          expect(trailOf(draft)).toBe(`pending-c-${door}`);
        });

        it("refuses a Single's publish when the pending change edits it", async () => {
          await pendingLedger(`s-${door}`);

          expect(await publish(door, "editor", { single: "ledger" })).toBe(400);
          const live = (await trusted.findSingle({
            slug: "ledger",
          } as never)) as Doc;
          expect(trailOf(live)).toBe(`live-s-${door}`);
        });
      });

      it("lets the allowed person publish it", async () => {
        const id = await pendingEntry("a");
        expect(
          await publish("direct", "allowed", { collection: "logged", id })
        ).toBe(200);
        expect(trailOf(await stored("logged", id))).toBe("pending-a");

        await pendingLedger("as");
        expect(await publish("direct", "allowed", { single: "ledger" })).toBe(
          200
        );
        const live = (await trusted.findSingle({
          slug: "ledger",
        } as never)) as Doc;
        expect(trailOf(live)).toBe("pending-as");
      });
    });

    describe("a held draft that removes an instance holding nothing protected", () => {
      /** The draft a published entry holds, as a by-id read with drafts. */
      const heldDraft = async (collection: string, id: string) =>
        (await trusted.findByID({
          collection,
          id,
          depth: 1,
          draft: true,
        } as never)) as Doc;

      it("records a cleared single field group", async () => {
        const { item } = await trusted.create({
          collection: "groupdrafted",
          data: { title: "c6", status: "published", one: { heading: "h" } },
        } as never);
        const id = String(item.id);
        await checkedAs("editor").update({
          collection: "groupdrafted",
          id,
          data: { one: null },
        } as never);

        const draft = await heldDraft("groupdrafted", id);
        expect(draft._isWorkingDraft).toBe(true);
        expect(list(draft.one)).toEqual([]);
      });

      it("records an instance left out of a list", async () => {
        const { item } = await trusted.create({
          collection: "drafted",
          data: {
            title: "c6l",
            status: "published",
            many: [{ heading: "a" }, { heading: "b" }],
          },
        } as never);
        const id = String(item.id);
        const [first] = list((await stored("drafted", id)).many);
        await checkedAs("editor").update({
          collection: "drafted",
          id,
          data: { many: [{ id: first.id, heading: "a" }] },
        } as never);

        const draft = await heldDraft("drafted", id);
        expect(draft._isWorkingDraft).toBe(true);
        expect(list(draft.many).map(note => note.heading)).toEqual(["a"]);
      });
    });

    describe("a held draft and its publish", () => {
      /** A `drafted` page, published, with every guarded value set. */
      async function publishedPage(tag: string): Promise<string> {
        const id = await seeded(tag, "drafted");
        await trusted.update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);
        return id;
      }

      it("keeps the fields its author may not write at their live values", async () => {
        const id = await publishedPage("hd");
        const live = await stored("drafted", id);
        // The editor's draft changes `locked`, which they may not write and
        // the publisher may.
        await checkedAs("editor").update({
          collection: "drafted",
          id,
          data: {
            one: {
              ...(live.one as Doc),
              heading: "h-draft",
              locked: "locked-hd-draft",
            },
          },
        } as never);
        // The allowed person may write all of it, and publishes the draft.
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);

        const after = await stored("drafted", id);
        const one = after.one as Doc;
        expect(one.heading).toBe("h-draft");
        expect(one.locked).toBe((live.one as Doc).locked);
      });

      it("keeps another author's pending edit inside a group a later save touches", async () => {
        const id = await publishedPage("hg");
        const live = await stored("drafted", id);
        const box = live.box as Doc;
        const inBox = box.inBox as Doc;
        // The allowed person's pending change to `locked`, which they may
        // write, held in the draft.
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: {
            box: { ...box, inBox: { ...inBox, locked: "locked-hg-pending" } },
          },
        } as never);
        // The editor, who may not write `locked`, then saves the same group.
        await checkedAs("editor").update({
          collection: "drafted",
          id,
          data: { box: { ...box, inBox: { ...inBox, heading: "h-hg" } } },
        } as never);

        const draft = (await trusted.findByID({
          collection: "drafted",
          id,
          depth: 1,
          draft: true,
        } as never)) as Doc;
        const held = (draft.box as Doc).inBox as Doc;
        expect([held.heading, held.locked]).toEqual([
          "h-hg",
          "locked-hg-pending",
        ]);
      });

      it("is refused when it adds an instance with a field no create may set", async () => {
        const id = await publishedPage("hn");
        const live = await stored("drafted", id);
        // A draft written by trusted code adds a new instance carrying a
        // field any update may change and no create may set.
        await trusted.update({
          collection: "drafted",
          id,
          data: {
            many: [...list(live.many), { heading: "h-new", later: "set" }],
          },
        } as never);

        await expect(
          checkedAs("allowed").update({
            collection: "drafted",
            id,
            data: { status: "published" },
          } as never)
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(list((await stored("drafted", id)).many)).toHaveLength(
          list(live.many).length
        );
      });

      it("publishes a collection whose only field rules are its field groups'", async () => {
        const { item } = await trusted.create({
          collection: "groupdrafted",
          data: {
            title: "g",
            status: "published",
            one: { heading: "h", ...guardedValues("g") },
          },
        } as never);
        const id = String(item.id);
        const live = await stored("groupdrafted", id);
        await checkedAs("allowed").update({
          collection: "groupdrafted",
          id,
          data: { one: { ...(live.one as Doc), heading: "h-g2" } },
        } as never);

        await checkedAs("allowed").update({
          collection: "groupdrafted",
          id,
          data: { status: "published" },
        } as never);

        expect(((await stored("groupdrafted", id)).one as Doc).heading).toBe(
          "h-g2"
        );
      });
    });

    describe("a release's readiness", () => {
      it("reports a pending field-group edit its author may not write, where only field groups have rules", async () => {
        const { item } = await trusted.create({
          collection: "groupdrafted",
          data: {
            title: "rel",
            status: "published",
            one: { heading: "h", ...guardedValues("rel") },
          },
        } as never);
        const id = String(item.id);
        const live = await stored("groupdrafted", id);
        // A pending change to `locked`, which the editor may not write.
        await checkedAs("allowed").update({
          collection: "groupdrafted",
          id,
          data: { one: { ...(live.one as Doc), locked: "locked-rel-draft" } },
        } as never);
        const handler = t.getService("collectionsHandler") as unknown as {
          releasePublishIssues: (params: {
            collectionName: string;
            entryIds: readonly string[];
            user: Doc;
            action: "publish" | "unpublish";
          }) => Promise<Map<string, { path?: string }[]>>;
        };
        const issuesFor = async (user: Doc) =>
          (
            await handler.releasePublishIssues({
              collectionName: "groupdrafted",
              entryIds: [id],
              user,
              action: "publish",
            })
          ).get(id) ?? [];

        // As the publish would: refused for the editor, and not for the
        // allowed person, who may write it.
        expect(
          (await issuesFor({ id: editorId })).map(issue => issue.path)
        ).toEqual(["one.locked"]);
        expect(await issuesFor({ id: allowedId, email: ALLOWED })).toEqual([]);
      });
    });

    describe("an update that removes a stored instance", () => {
      it("keeps one holding a value the updater may not change", async () => {
        const id = await seeded("rm");
        const before = await stored("pages", id);
        await updateAs("direct", "editor", id, {
          one: null,
          many: list(before.many).slice(0, 1),
        });

        const after = await stored("pages", id);
        expect((after.one as Doc).locked).toBe("locked-rm-one");
        expect(list(after.many).map(note => note.locked)).toEqual([
          "locked-rm-many0",
          "locked-rm-many1",
        ]);
      });

      it("keeps a single dynamic-zone block holding a value the updater may not change", async () => {
        const { item } = await trusted.create({
          collection: "pages",
          data: {
            title: "rmz",
            oneZone: typed("note", { heading: "h", ...guardedValues("rmz") }),
          },
        } as never);
        const id = String(item.id);
        await updateAs("direct", "editor", id, { oneZone: null });

        // A dynamic zone reads back as a list, whatever it holds.
        const after = list((await stored("pages", id)).oneZone);
        expect(after.map(block => block.locked)).toEqual(["locked-rmz"]);
      });

      it("keeps a single dynamic-zone block another block would replace", async () => {
        const { item } = await trusted.create({
          collection: "pages",
          data: {
            title: "rpz",
            oneZone: typed("note", { heading: "h", ...guardedValues("rpz") }),
          },
        } as never);
        const id = String(item.id);
        // A block of another type, which the save would add in place of the
        // stored one, deleting it.
        await updateAs("direct", "editor", id, {
          oneZone: typed("quote", { line: "q" }),
        });

        const after = list((await stored("pages", id)).oneZone);
        expect(after.map(block => block.locked)).toEqual(["locked-rpz"]);
      });

      it("removes it for an updater who may change everything it holds", async () => {
        // The control: nothing it holds is beyond them, so it goes.
        const { item } = await trusted.create({
          collection: "pages",
          data: {
            title: "rm2",
            one: { heading: "h", locked: "locked-rm2" },
            many: [{ heading: "a" }, { heading: "b" }],
          },
        } as never);
        const id = String(item.id);
        const before = await stored("pages", id);
        await updateAs("direct", "allowed", id, {
          one: null,
          many: list(before.many).slice(0, 1),
        });

        const after = await stored("pages", id);
        expect(list(after.one)).toEqual([]);
        expect(list(after.many).map(note => note.heading)).toEqual(["a"]);
      });
    });

    describe("an update whose own change turns a rule against a stored value", () => {
      it("keeps the value the document it writes denies", async () => {
        // `gated` may be written only while `mode` is open. The update closes
        // `mode` and does not mention `gated`, so the rule is never asked
        // about `gated` on the update; judged against the document this write
        // LEAVES, it is denied, and a container written whole must not drop it.
        const { item } = await trusted.create({
          collection: "pages",
          data: { title: "sib", gate: { mode: "open", gated: "keep-me" } },
        } as never);
        const id = String(item.id);

        await updateAs("direct", "editor", id, { gate: { mode: "closed" } });

        const after = (await stored("pages", id)).gate as Doc;
        expect(after.mode).toBe("closed");
        expect(after.gated).toBe("keep-me");
      });
    });

    describe("a held draft that removes a stored instance", () => {
      it("keeps one holding a value its author may not change", async () => {
        const id = await seeded("hdrm", "drafted");
        await trusted.update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);
        const live = await stored("drafted", id);
        // Held, so no save judges the instances it removes.
        await checkedAs("editor").update({
          collection: "drafted",
          id,
          data: { one: null, many: list(live.many).slice(0, 1) },
        } as never);
        // The publisher may write everything, so nothing stops the removal
        // except the draft having been judged when it was held.
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);

        // Each instance is the stored one, kept whole with its id: a partial
        // copy of its denied values would be a new instance, and lose what no
        // create may set.
        const after = await stored("drafted", id);
        const one = after.one as Doc;
        expect([one.id, one.locked, one.sealed]).toEqual([
          (live.one as Doc).id,
          "locked-hdrm-one",
          "sealed-hdrm-one",
        ]);
        expect(
          list(after.many).map(note => [note.id, note.locked, note.sealed])
        ).toEqual(
          list(live.many).map((note, index) => [
            note.id,
            `locked-hdrm-many${index}`,
            `sealed-hdrm-many${index}`,
          ])
        );
      });
    });

    describe("the promotion's judgment of a stored instance", () => {
      it("tells an id-dependent rule the id the save will tell it", async () => {
        // `owned` is writable only on the instance whose id the rule is told,
        // and the gate must be told the same id the save is, or it answers a
        // question the save does not ask.
        const id = await seeded("idr", "drafted");
        await trusted.update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);
        const live = await stored("drafted", id);

        // The draft changes `owned`, which any judgment told the stored
        // instance's id allows, and one told nothing denies.
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: { one: { ...(live.one as Doc), owned: "owned-idr" } },
        } as never);
        await checkedAs("allowed").update({
          collection: "drafted",
          id,
          data: { status: "published" },
        } as never);

        const one = (await stored("drafted", id)).one as Doc;
        expect([one.id, one.owned]).toEqual([
          (live.one as Doc).id,
          "owned-idr",
        ]);
      });
    });

    describe("the restore of a version", () => {
      it("does not write back a field-group field the restorer may not write", async () => {
        const id = await seeded("v1", "versioned");
        const first = await stored("versioned", id);
        // A second version, as trusted code writes it.
        await trusted.update({
          collection: "versioned",
          id,
          data: {
            title: "page-v2",
            one: {
              ...(first.one as Doc),
              heading: "h2",
              ...guardedValues("v2"),
            },
          },
        } as never);

        await restoreVersion({
          scopeKind: "collection",
          slug: "versioned",
          entryId: id,
          versionNo: 1,
          user: { id: editorId },
        } as never);
        const after = await stored("versioned", id);
        // What the restorer may write comes back; what they may not stays.
        expect(after.title).toBe("page-v1");
        expect((after.one as Doc).heading).toBe("h");
        expect((after.one as Doc).locked).toBe("locked-v2");
        expect((after.one as Doc).sealed).toBe("sealed-v2");
      });
    });

    describe("trusted server code", () => {
      it("still writes every field-group field", async () => {
        const id = await seeded("trusted");
        const doc = await stored("pages", id);
        expect(inNotes(doc, "locked").every(v => typeof v === "string")).toBe(
          true
        );
        expect(inNotes(doc, "sealed").every(v => typeof v === "string")).toBe(
          true
        );
      });
    });
  }
);
