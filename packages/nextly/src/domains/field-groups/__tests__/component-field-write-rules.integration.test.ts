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

/** The guarded fields a field group and the collection itself carry. */
const guarded = () => [
  text({
    name: "locked",
    access: { create: onlyAllowed, update: onlyAllowed },
  }),
  text({ name: "sealed", access: { create: false, update: false } }),
];

/** Values for both guarded fields, marked with where they were written. */
function guardedValues(tag: string): Doc {
  return { locked: `locked-${tag}`, sealed: `sealed-${tag}` };
}

function typed(type: string, data: Doc): Doc {
  const instance: Doc = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
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
        group({
          name: "box",
          fields: [fieldGroup({ name: "inBox", component: "note" })],
        }),
      ];
      const singleFields = () => [
        text({ name: "title" }),
        group({ name: "meta", fields: [...guarded()] }),
        fieldGroup({ name: "one", component: "note" }),
      ];
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "note",
            fields: [text({ name: "heading" }), ...guarded()],
          }),
          defineFieldGroup({
            slug: "quote",
            fields: [text({ name: "line" })],
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
          // History to restore from.
          defineCollection({
            slug: "versioned",
            versions: true,
            fields: pageFields(),
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
              ...["pages", "drafted", "versioned"].flatMap(slug => [
                `create-${slug}`,
                `read-${slug}`,
                `update-${slug}`,
              ]),
              "publish-drafted",
              "read-site",
              "update-site",
              "read-board",
              "update-board",
              "publish-board",
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
        ).rejects.toMatchObject({ statusCode: 403 });
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
        ).rejects.toMatchObject({ statusCode: 403 });
        const after = (await trusted.findSingle({
          slug: "board",
        } as never)) as Doc;
        expect((after.one as Doc).locked).toBe("locked-board");
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
