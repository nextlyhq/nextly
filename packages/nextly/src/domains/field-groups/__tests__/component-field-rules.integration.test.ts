/**
 * Field rules on fields inside a field group decide them on every live read,
 * as a collection's own field rules decide its fields.
 *
 * The field group `note` carries `secret`, readable only by the allowed
 * person. It sits in every shape a field group takes that is stored: single,
 * repeatable, a dynamic zone, and inside a group field. The collection carries
 * the same rule on a field of its own, the control that the mechanism works
 * where it is applied today.
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

/** The guarded field every field group and the collection itself carries. */
const guarded = () => [text({ name: "secret", access: { read: onlyAllowed } })];

/** A value for the guarded field, marked with where it was written. */
function guardedValues(tag: string): Doc {
  return { secret: `secret-${tag}` };
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
      method: "GET",
      path: string[],
      body?: unknown
    ) {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      return handlers[method]!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method,
          headers: { cookie: cookies[who], "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    async function seed(tag: string): Promise<string> {
      const { item } = await trusted.create({
        collection: "pages",
        data: pageData(tag),
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
        const res =
          shape === "byId"
            ? await rest(who, "GET", ["collections", "pages", "entries", id])
            : await rest(who, "GET", ["collections", "pages", "entries"]);
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
          defineFieldGroup({
            slug: "quote",
            fields: [text({ name: "line" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: "pages",
            fields: [
              text({ name: "title" }),
              ...guarded(),
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
            permissionIds: ["read-pages", "read-site"].map(id),
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
          // The collection's own field: the control.
          expect(asEditor).not.toHaveProperty("secret");

          const asAllowed = await readVia(door, "allowed", id, shape);
          expect(noteInstances(asAllowed)).toHaveLength(5);
          expect(secrets(asAllowed).every(v => typeof v === "string")).toBe(
            true
          );
        }
      );
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

        const allowed = (await checkedAs("allowed").findSingle({
          slug: "site",
        } as never)) as Doc;
        expect((allowed.one as Doc).secret).toBe("secret-site");
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
        const count = async (rows: number) => {
          for (let i = 0; i < rows; i++) {
            await trusted.create({
              collection: "pages",
              data: pageData(`n${rows}-${i}`),
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
              collection: "pages",
              depth: 1,
              limit: rows,
            } as never);
          } finally {
            spy.mockRestore();
          }
          return statements;
        };
        const few = await count(2);
        const more = await count(6);
        expect(more).toBe(few);
      });
    });
  }
);
