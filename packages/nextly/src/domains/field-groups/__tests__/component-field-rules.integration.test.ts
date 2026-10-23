/**
 * Field rules on fields inside a field group decide them on every live read,
 * as a collection's own field rules decide its fields.
 *
 * The field group `note` carries `secret`, readable only by the allowed
 * person, and `label`, readable whenever `secret` is present in the stored
 * instance: a rule whose evidence a pass removes. It sits in every shape a
 * field group takes that is stored: single, repeatable, a dynamic zone, and
 * inside a group field. The collection carries the same rules on fields of
 * its own, the control that the mechanism works where it is applied today.
 * A related collection holds the field group too, and a populated row of it
 * is judged by its own rules; a write's response is judged as a read.
 *
 * Every read is made by an editor who may read the collection (or Single),
 * over REST and through the checked Direct API, beside the allowed person and
 * trusted server code. The documents are written by trusted code, so what a
 * read returns depends on the read rules alone.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { getTableName, isTable } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  relationship,
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
import { writeFieldGroupType } from "../storage/field-group-type-key";

type Doc = Record<string, unknown>;

const ALLOWED = "allowed@example.com";
const onlyAllowed = ({ user }: { user: unknown }) =>
  (user as { email?: string } | null)?.email === ALLOWED;

/** Readable while the instance holds `secret`, which a reader may be denied. */
const whileSecretStored = ({ data }: { data?: Doc }) =>
  typeof data?.secret === "string";

/**
 * Readable by a caller holding `update-site`: the editors' role does, and a
 * key they own scoped without it does not, so it tells the key's grants
 * from its owner's.
 */
const holdsUpdateSite = ({
  permissions,
}: {
  permissions?: readonly string[];
}) => permissions?.includes("update-site") === true;

/** The guarded fields every field group and the collection itself carries. */
const guarded = () => [
  text({ name: "secret", access: { read: onlyAllowed } }),
  text({ name: "label", access: { read: whileSecretStored } }),
  text({ name: "ownerOnly", access: { read: holdsUpdateSite } }),
];

/** Values for the guarded fields, marked with where they were written. */
function guardedValues(tag: string): Doc {
  return {
    secret: `secret-${tag}`,
    label: `label-${tag}`,
    ownerOnly: `owner-${tag}`,
  };
}

function typed(type: string, data: Doc): Doc {
  const instance: Doc = { ...data };
  writeFieldGroupType(instance, type);
  return instance;
}

/** A page carrying the field group in every shape, and a guarded field of its own. */
function pageData(tag: string): Doc {
  return {
    title: `page-${tag}`,
    ...guardedValues(`${tag}-top`),
    one: { heading: "h", ...guardedValues(`${tag}-one`) },
    many: [
      { heading: "h", ...guardedValues(`${tag}-many0`) },
      { heading: "h", ...guardedValues(`${tag}-many1`) },
    ],
    zone: [
      typed("note", { heading: "h", ...guardedValues(`${tag}-zone`) }),
      typed("quote", { line: "q" }),
    ],
    box: {
      inBox: { heading: "h", ...guardedValues(`${tag}-box`) },
    },
  };
}

/** Every place a `note` instance sits in a read page. */
function noteInstances(doc: Doc): Doc[] {
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : value ? [value] : []) as Doc[];
  const box = list(doc.box)[0];
  return [
    ...list(doc.one),
    ...list(doc.many),
    ...list(doc.zone).filter(row => "heading" in row),
    ...list(box?.inBox),
  ];
}

/** The tables a caller's roles and permissions are resolved from. */
const CALLER_TABLES = new Set([
  "user_roles",
  "roles",
  "role_permissions",
  "role_inherits",
  "permissions",
]);
/** What the guarded field holds in `doc` and in every note instance. */
function secrets(doc: Doc): unknown[] {
  return [doc.secret, ...noteInstances(doc).map(note => note.secret)];
}

describe.each(getConfiguredTestDialects())(
  "field rules inside field groups, on reads (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let editorId: string;
    let allowedId: string;
    let editorRoleId: string;
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
      method: "GET" | "POST",
      path: string[],
      options: { body?: unknown; query?: string } = {}
    ) {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const url = `http://localhost/api/${path.join("/")}${options.query ?? ""}`;
      return handlers[method]!(
        new Request(url, {
          method,
          headers: { cookie: cookies[who], "content-type": "application/json" },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
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

    /** A page written by trusted code, so no write rule shapes what is read. */
    async function seed(tag: string, extra: Doc = {}): Promise<string> {
      const { item } = await trusted.create({
        collection: "pages",
        data: { ...pageData(tag), ...extra },
      } as never);
      return String(item.id);
    }

    async function readVia(
      door: "rest" | "direct",
      who: "editor" | "allowed",
      id: string,
      shape: "byId" | "list"
    ): Promise<Doc> {
      if (door === "rest") {
        // Populated one level, as the Direct API reads below are.
        const query = "?depth=1";
        const res =
          shape === "byId"
            ? await rest(who, "GET", ["collections", "pages", "entries", id], {
                query,
              })
            : await rest(who, "GET", ["collections", "pages", "entries"], {
                query,
              });
        expect(res.status).toBe(200);
        const body = (await res.json()) as Doc & { items?: Doc[] };
        return shape === "byId"
          ? body
          : (body.items ?? []).find(item => item.id === id)!;
      }
      const as = checkedAs(who);
      if (shape === "byId") {
        return (await as.findByID({
          collection: "pages",
          id,
          depth: 1,
        } as never)) as Doc;
      }
      const found = (await as.find({
        collection: "pages",
        depth: 1,
        limit: 100,
      } as never)) as { items: Doc[] };
      return found.items.find(item => item.id === id)!;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: "note",
            fields: [text({ name: "heading" }), ...guarded()],
          }),
          // Holds a `note`, inside a group, and a field whose rule reads it.
          defineFieldGroup({
            slug: "card",
            fields: [
              text({ name: "caption" }),
              text({
                name: "peek",
                access: {
                  read: ({ data }: { data?: Doc }) =>
                    ((data?.box as Doc | undefined)?.held as Doc | undefined)
                      ?.secret === undefined,
                },
              }),
              group({
                name: "box",
                fields: [fieldGroup({ name: "held", component: "note" })],
              }),
            ],
          }),
          defineFieldGroup({
            slug: "quote",
            fields: [text({ name: "line" })],
          }),
        ],
        collections: [
          // Related from a page, holding the field group as a page does.
          defineCollection({
            slug: "authors",
            fields: [
              text({ name: "name" }),
              fieldGroup({ name: "one", component: "note" }),
              group({
                name: "box",
                fields: [fieldGroup({ name: "inBox", component: "note" })],
              }),
            ],
          }),
          // A field whose rule reads a field-group value, beside a hook that
          // sets that field from a sibling: the second pass must judge it
          // against the stored field group, not the one the first pass cut.
          defineCollection({
            slug: "hinted",
            fields: [
              text({
                name: "title",
                hooks: {
                  afterRead: [
                    ({ value, data }: { value: unknown; data: Doc }) => {
                      data.hint = "hint-from-hook";
                      return value;
                    },
                  ],
                },
              }),
              text({
                name: "hint",
                access: {
                  read: ({ data }: { data?: Doc }) =>
                    (data?.one as Doc | undefined)?.secret === undefined,
                },
              }),
              fieldGroup({ name: "one", component: "note" }),
            ],
          }),
          // A field group holding another, and a hook that sets the outer one's
          // field: judged against the inner one as stored, on both passes.
          defineCollection({
            slug: "nested",
            fields: [
              text({
                name: "title",
                hooks: {
                  afterRead: [
                    ({ value, data }: { value: unknown; data: Doc }) => {
                      const card = data.card as Doc | undefined;
                      if (card) card.peek = "peek-from-hook";
                      return value;
                    },
                  ],
                },
              }),
              fieldGroup({ name: "card", component: "card" }),
            ],
          }),
          // A held edit: its response is the pending document.
          defineCollection({
            slug: "drafted",
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "one", component: "note" }),
            ],
          }),
          // The cost control: the same rules, and no field group.
          defineCollection({
            slug: "plain",
            fields: [text({ name: "title" }), ...guarded()],
          }),
          defineCollection({
            slug: "pages",
            fields: [
              text({ name: "title" }),
              ...guarded(),
              relationship({ name: "author", relationTo: "authors" }),
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
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: "site",
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "one", component: "note" }),
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
      editorRoleId = (
        await trusted.roles.create({
          data: {
            name: "editors",
            slug: "editors",
            permissionIds: [
              "create-pages",
              "read-pages",
              "read-authors",
              "read-plain",
              "read-hinted",
              "read-nested",
              "read-drafted",
              "update-drafted",
              "read-site",
              "update-site",
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

    describe.each(["rest", "direct"] as const)("through %s", door => {
      it.each(["byId", "list"] as const)(
        "withholds, read %s, every field-group field the reader may not read",
        async shape => {
          const id = await seed(`r-${door}-${shape}`);
          const asEditor = await readVia(door, "editor", id, shape);
          const notes = noteInstances(asEditor);
          expect(notes).toHaveLength(5);
          expect(notes.map(note => "secret" in note)).toEqual(
            notes.map(() => false)
          );
          // Only what the rule denies: the instance's other fields stay.
          expect(notes.every(note => note.heading === "h")).toBe(true);
          // `label` is judged by the stored `secret`, which the pass after the
          // hooks sees only as the evidence the pass before them removed.
          expect(notes.map(note => typeof note.label)).toEqual(
            notes.map(() => "string")
          );
          // The collection's own fields: the control.
          expect(asEditor).not.toHaveProperty("secret");
          expect(typeof asEditor.label).toBe("string");

          const asAllowed = await readVia(door, "allowed", id, shape);
          expect(noteInstances(asAllowed)).toHaveLength(5);
          expect(secrets(asAllowed).every(v => typeof v === "string")).toBe(
            true
          );
        }
      );

      it.each(["byId", "list"] as const)(
        "withholds, read %s, a field-group field inside a populated related row",
        async shape => {
          const { item: author } = await trusted.create({
            collection: "authors",
            data: {
              name: `author-${door}-${shape}`,
              one: { heading: "h", ...guardedValues("author-one") },
              box: {
                inBox: { heading: "h", ...guardedValues("author-box") },
              },
            },
          } as never);
          const id = await seed(`rel-${door}-${shape}`, {
            author: String(author.id),
          });

          const asEditor = await readVia(door, "editor", id, shape);
          const related = asEditor.author as Doc;
          expect(related.name).toBe(`author-${door}-${shape}`);
          const notes = noteInstances(related);
          expect(notes.length).toBeGreaterThan(0);
          expect(notes.map(note => "secret" in note)).toEqual(
            notes.map(() => false)
          );
          expect(notes.map(note => typeof note.label)).toEqual(
            notes.map(() => "string")
          );

          const asAllowed = await readVia(door, "allowed", id, shape);
          const seenByAllowed = noteInstances(asAllowed.author as Doc);
          expect(seenByAllowed).toHaveLength(notes.length);
          expect(
            seenByAllowed.every(note => typeof note.secret === "string")
          ).toBe(true);
        }
      );

      it("withholds, in a create's response, every field-group field the writer may not read", async () => {
        const data = pageData(`w-${door}`);
        const item =
          door === "rest"
            ? (
                (await (
                  await rest(
                    "editor",
                    "POST",
                    ["collections", "pages", "entries"],
                    { body: data }
                  )
                ).json()) as { item: Doc }
              ).item
            : ((
                await checkedAs("editor").create({
                  collection: "pages",
                  data,
                } as never)
              ).item as Doc);
        const notes = noteInstances(item);
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.map(note => "secret" in note)).toEqual(
          notes.map(() => false)
        );
        expect(item).not.toHaveProperty("secret");
      });
    });

    describe("a Single", () => {
      it("withholds a field-group field its reader may not read", async () => {
        await trusted.updateSingle({
          slug: "site",
          data: { title: "s", one: { heading: "h", ...guardedValues("site") } },
        } as never);

        const read = (await checkedAs("editor").findSingle({
          slug: "site",
        } as never)) as Doc;
        expect((read.one as Doc).heading).toBe("h");
        expect(read.one).not.toHaveProperty("secret");
        expect((read.one as Doc).label).toBe("label-site");

        const allowed = (await checkedAs("allowed").findSingle({
          slug: "site",
        } as never)) as Doc;
        expect((allowed.one as Doc).secret).toBe("secret-site");
      });

      it("answers an update with the stored row, which holds no field-group instance", async () => {
        const result = (await checkedAs("editor").updateSingle({
          slug: "site",
          data: { title: "s2", one: { heading: "h2", ...guardedValues("w") } },
        } as never)) as unknown as { item: Doc };
        // The response is the stored Single row: its field groups live in
        // their own tables, and the update hooks cannot reshape it (their
        // return is discarded). So there is no instance here for a field rule
        // to judge; should one ever appear, this fails before it is shown.
        expect(result.item.title).toBe("s2");
        expect(result.item).not.toHaveProperty("one");
        expect(JSON.stringify(result)).not.toContain("secret-w");
      });
    });

    describe("a collection rule that reads a field-group value", () => {
      it("is judged against the stored field group on both passes", async () => {
        const { item } = await trusted.create({
          collection: "hinted",
          data: {
            title: "t",
            hint: "stored-hint",
            one: { heading: "h", ...guardedValues("hinted") },
          },
        } as never);
        const id = String(item.id);
        // The stored instance holds `secret`, so `hint` is withheld from
        // everyone, whatever the field group shows them and whatever a hook
        // puts back.
        for (const who of ["editor", "allowed"] as const) {
          const read = (await checkedAs(who).findByID({
            collection: "hinted",
            id,
            depth: 1,
          } as never)) as Doc;
          expect(read.title).toBe("t");
          expect(read).not.toHaveProperty("hint");
        }
      });
    });

    describe("a field-group rule that reads a field group inside it", () => {
      it("is judged against the inner field group as stored on both passes", async () => {
        const { item } = await trusted.create({
          collection: "nested",
          data: {
            title: "t",
            card: {
              caption: "c",
              peek: "stored-peek",
              box: { held: { heading: "h", ...guardedValues("held") } },
            },
          },
        } as never);
        const id = String(item.id);
        // The stored inner instance holds `secret`, so `peek` is withheld
        // from everyone, whatever a hook puts back.
        for (const who of ["editor", "allowed"] as const) {
          const read = (await checkedAs(who).findByID({
            collection: "nested",
            id,
            depth: 1,
          } as never)) as Doc;
          const card = read.card as Doc;
          expect(card.caption).toBe("c");
          expect(card).not.toHaveProperty("peek");
        }
      });
    });

    describe("a filter on a field-group field", () => {
      it("is refused where the field group's rule hides the field, as on the collection's own", async () => {
        const id = await seed("filter");
        const secret = "secret-filter-one";

        // Which rows match is an answer about the hidden value, so the reader
        // may not ask it, through either door.
        await expect(
          checkedAs("editor").find({
            collection: "pages",
            where: { "one.secret": { equals: secret } },
          } as never)
        ).rejects.toMatchObject({ statusCode: 400 });
        const res = await rest(
          "editor",
          "GET",
          ["collections", "pages", "entries"],
          { query: `?where[one.secret][equals]=${secret}` }
        );
        expect(res.status).toBe(400);

        // The controls: a field the rule leaves readable filters as before,
        // and the allowed person may ask about the guarded one.
        const byHeading = (await checkedAs("editor").find({
          collection: "pages",
          where: { "one.heading": { equals: "h" } },
          limit: 100,
        } as never)) as { items: Doc[] };
        expect(byHeading.items.map(item => item.id)).toContain(id);
        const asAllowed = (await checkedAs("allowed").find({
          collection: "pages",
          where: { "one.secret": { equals: secret } },
        } as never)) as { items: Doc[] };
        expect(asAllowed.items.map(item => item.id)).toEqual([id]);
      });
    });

    describe("an edit held inside a caller's transaction", () => {
      it("answers with the pending document, its field-group fields judged", async () => {
        const { item } = await trusted.create({
          collection: "drafted",
          data: {
            title: "d",
            status: "published",
            one: { heading: "h", ...guardedValues("live") },
          },
        } as never);
        const id = String(item.id);
        const service = t.getService("collectionService") as unknown as {
          withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
          updateEntryInTransaction: (
            tx: unknown,
            slug: string,
            entryId: string,
            data: Doc,
            ctx: Doc
          ) => Promise<Doc>;
        };
        // Status-less, so the edit is held as the pending change.
        const held = await service.withTransaction(tx =>
          service.updateEntryInTransaction(
            tx,
            "drafted",
            id,
            { title: "d2", one: { heading: "h2", ...guardedValues("held") } },
            { user: { id: editorId }, overrideAccess: false }
          )
        );
        expect(held.title).toBe("d2");
        const one = held.one as Doc;
        expect(one.heading).toBe("h2");
        expect(one).not.toHaveProperty("secret");
        expect(one.label).toBe("label-held");
      });
    });

    describe("a scoped API key", () => {
      // Owned by the editor, who holds `update-site`; the key does not.
      const asKey = () =>
        new Nextly({
          overrideAccess: false,
          user: { id: editorId },
          actor: {
            actorType: "apiKey",
            permissions: [
              "create-pages",
              "read-pages",
              "read-authors",
              "read-site",
            ],
          },
        } as never);
      const ownerOnlyIn = (doc: Doc) =>
        noteInstances(doc).map(note => "ownerOnly" in note);

      it("is judged by its own grants in a related row, a create's response and a Single", async () => {
        const { item: author } = await trusted.create({
          collection: "authors",
          data: {
            name: "key-author",
            box: { inBox: { heading: "h", ...guardedValues("key-author") } },
          },
        } as never);
        const id = await seed("key", { author: String(author.id) });

        // The owner, the control: the rule lets them read it.
        const asOwner = (await checkedAs("editor").findByID({
          collection: "pages",
          id,
          depth: 1,
        } as never)) as Doc;
        expect(ownerOnlyIn(asOwner.author as Doc)).toContain(true);

        const read = (await asKey().findByID({
          collection: "pages",
          id,
          depth: 1,
        } as never)) as Doc;
        const related = noteInstances(read.author as Doc);
        expect(related.length).toBeGreaterThan(0);
        expect(related.map(note => "ownerOnly" in note)).toEqual(
          related.map(() => false)
        );

        const created = (
          await asKey().create({
            collection: "pages",
            data: pageData("key-write"),
          } as never)
        ).item as Doc;
        expect(ownerOnlyIn(created)).toEqual(
          noteInstances(created).map(() => false)
        );

        const single = (await asKey().findSingle({
          slug: "site",
        } as never)) as Doc;
        expect(single.one).toBeDefined();
        expect(single.one).not.toHaveProperty("ownerOnly");
      });
    });

    describe("trusted server code", () => {
      it("still reads every field-group field", async () => {
        const id = await seed("trusted");
        const doc = (await trusted.findByID({
          collection: "pages",
          id,
          depth: 1,
        } as never)) as Doc;
        expect(noteInstances(doc)).toHaveLength(5);
        expect(secrets(doc).every(v => typeof v === "string")).toBe(true);
      });
    });

    describe("the cost of a list read", () => {
      it("asks the caller's roles and permissions once, however many rows", async () => {
        const db = t.adapter.getDrizzle() as {
          select: (...a: unknown[]) => unknown;
        };
        const select = db.select.bind(db);
        const count = async (collection: "pages" | "plain", rows: number) => {
          for (let i = 0; i < rows; i++) {
            await trusted.create({
              collection,
              data:
                collection === "pages"
                  ? pageData(`n${rows}-${i}`)
                  : { title: `p${rows}-${i}`, ...guardedValues(`p${i}`) },
            } as never);
          }
          let statements = 0;
          const spy = vi.spyOn(db, "select").mockImplementation((...args) => {
            const builder = select(...args) as {
              from: (table: unknown, ...rest: unknown[]) => unknown;
            };
            const from = builder.from.bind(builder);
            builder.from = (table: unknown, ...rest: unknown[]) => {
              // What the field rules' caller is resolved from: read once per
              // request, however many rows and component instances it judges.
              if (isTable(table) && CALLER_TABLES.has(getTableName(table))) {
                statements += 1;
              }
              return from(table, ...rest);
            };
            return builder;
          });
          try {
            await checkedAs("editor").find({
              collection,
              depth: 1,
              limit: rows,
            } as never);
          } finally {
            spy.mockRestore();
          }
          return statements;
        };
        // The gate above the field rules keeps what it reads between reads, so
        // the first read pays for it; measured after it, as every read is.
        await count("plain", 1);
        // One resolution, as measured on a collection whose rules are its own
        // fields' alone: the field groups' rules add no lookup to it.
        const once = await count("plain", 2);
        expect(once).toBeGreaterThan(0);
        expect(await count("pages", 2)).toBe(once);
        expect(await count("pages", 6)).toBe(once);
      });
    });
  }
);
