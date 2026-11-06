/**
 * The Direct API's reads of users, roles and permissions, media and field
 * groups are checked when the call asks to be.
 *
 * A Nextly instance (or a single call) with `overrideAccess: false` is judged
 * as the REST routes judge its caller, read by read: `read-users`; `read-roles`
 * for roles and the permission list, and `read-roles` or `read-permissions`
 * for one permission and a role's permissions; `read-media`; and
 * `read-settings` for field groups. A refused read
 * returns nothing, a call naming no user is refused as unauthenticated, and an
 * allowed one returns the rows REST returns that same person. A trusted
 * instance, the default, reads as it always has.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../api/media-handlers";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { runWithCallerScope } from "../../auth/caller-scope";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineFieldGroup, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { pdfDocument } from "../../services/upload-validation/__tests__/format-fixtures";
import { Nextly } from "../nextly";

import { account, role, seedPermissions } from "./checked-access-fixtures";

const ORIGIN = "http://localhost";
const FIELD_GROUP = "checkedreadsmeta";
const PDF = pdfDocument("checked reads");

/**
 * The people every read is asked as. No one holds `read-permissions`, which
 * REST also accepts for one permission and a role's permissions: permissions
 * on `permissions` are hidden, so none is seeded or can be read back to grant.
 */
type Person = "reader" | "lacker";
const PEOPLE: readonly Person[] = ["reader", "lacker"];

/** What a read needs in hand: the rows it names, made by trusted code. */
interface Subjects {
  userId: string;
  roleId: string;
  permissionId: string;
  fileId: string;
}

/**
 * Each read, and the people REST lets make it: the grant each one asks, held
 * by exactly those people, so a read mapped to the wrong grant is told apart.
 */
const READS: readonly {
  name: string;
  allowed: readonly Person[];
  read: (n: Nextly, s: Subjects) => Promise<unknown>;
}[] = [
  { name: "users.find", allowed: ["reader"], read: n => n.users.find() },
  {
    name: "users.findOne",
    allowed: ["reader"],
    read: n => n.users.findOne({ search: "example.com" }),
  },
  {
    name: "users.findByID",
    allowed: ["reader"],
    read: (n, s) => n.users.findByID({ id: s.userId }),
  },
  { name: "roles.find", allowed: ["reader"], read: n => n.roles.find() },
  {
    name: "roles.findByID",
    allowed: ["reader"],
    read: (n, s) => n.roles.findByID({ id: s.roleId }),
  },
  {
    name: "roles.getPermissions",
    allowed: ["reader"],
    read: (n, s) => n.roles.getPermissions({ id: s.roleId }),
  },
  {
    // REST lists permissions to `read-roles` alone: the role form needs them.
    name: "permissions.find",
    allowed: ["reader"],
    read: n => n.permissions.find(),
  },
  {
    name: "permissions.findByID",
    allowed: ["reader"],
    read: (n, s) => n.permissions.findByID({ id: s.permissionId }),
  },
  { name: "media.find", allowed: ["reader"], read: n => n.media.find() },
  {
    name: "media.findByID",
    allowed: ["reader"],
    read: (n, s) => n.media.findByID({ id: s.fileId }),
  },
  {
    name: "media.folders.list",
    allowed: ["reader"],
    read: n => n.media.folders.list(),
  },
  {
    // REST's catch-all serves field groups to any signed-in caller: the
    // builder's palette reads them, so no grant is asked.
    name: "fieldGroups.find",
    allowed: PEOPLE,
    read: n => n.fieldGroups.find(),
  },
  {
    name: "fieldGroups.findBySlug",
    allowed: PEOPLE,
    read: n => n.fieldGroups.findBySlug({ slug: FIELD_GROUP }),
  },
];

describe.each(getConfiguredTestDialects())(
  "the Direct API's system reads under access checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let subjects: Subjects;
    const ids = {} as Record<Person, string>;
    const roleIds = {} as Record<Person, string[]>;

    /** An instance that asks to be checked, as this person. */
    function checkedAs(person: Person): Nextly {
      return new Nextly({ overrideAccess: false, user: { id: ids[person] } });
    }

    /** A signed session for this person, as the admin sends one. */
    async function cookieOf(person: Person): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId: ids[person],
          email: `${person}@example.com`,
          name: person,
          image: null,
          roleIds: roleIds[person],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** A REST read through the dispatcher, as this person. */
    async function rest(
      person: Person,
      segments: string[],
      search = ""
    ): Promise<Response> {
      const req = new Request(`${ORIGIN}/api/${segments.join("/")}${search}`, {
        headers: { origin: ORIGIN, cookie: await cookieOf(person) },
      });
      return createDynamicHandlers().GET(req, {
        params: Promise.resolve({ params: segments }),
      });
    }

    /** A REST read through the admin's media routes, as this person. */
    async function restMedia(
      person: Person,
      segments: string[]
    ): Promise<Response> {
      const req = new Request(`${ORIGIN}/api/media/${segments.join("/")}`, {
        headers: { origin: ORIGIN, cookie: await cookieOf(person) },
      });
      return createMediaHandlers({ requireAuth: true }).GET(req, {
        params: Promise.resolve({ path: segments }),
      });
    }

    /** The body of a REST read that must have been allowed. */
    async function allowedBody<T>(res: Promise<Response>): Promise<T> {
      const answered = await res;
      expect(answered.status, "REST allows this person").toBe(200);
      return (await answered.json()) as T;
    }

    const idsOf = (items: readonly { id: unknown }[]) =>
      items.map(item => String(item.id)).sort();

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        fieldGroups: [
          defineFieldGroup({
            slug: FIELD_GROUP,
            fields: [text({ name: "heading" })],
          }),
        ],
      });
      trusted = new Nextly();
      await seedPermissions(t);

      // The install's first account holds super-admin, which answers every
      // check; the people under test come after it.
      const ownerId = await account(t, "owner@example.com");
      const grants: Record<Person, string[]> = {
        reader: ["read-users", "read-roles", "read-media", "read-settings"],
        // A role, so the refusal is for want of the grant, not of any role.
        lacker: ["read-api-keys"],
      };
      for (const person of PEOPLE) {
        const slug = `${person.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}-role`;
        const roleId = await role(t, slug, grants[person]);
        roleIds[person] = [roleId];
        ids[person] = await account(t, `${person}@example.com`, [roleId]);
      }

      const permissions = await trusted.permissions.find({ limit: 1 });
      const uploaded = await trusted.media.upload({
        file: {
          data: PDF,
          name: "subject.pdf",
          mimetype: "application/pdf",
          size: PDF.length,
        },
      });
      // A folder records who made it, so trusted code names its maker.
      await trusted.media.folders.create({
        name: "subject",
        user: { id: ownerId },
      });
      subjects = {
        userId: ids.lacker,
        roleId: roleIds.reader[0],
        permissionId: permissions.items[0].id,
        fileId: uploaded.id,
      };
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    for (const { name, allowed, read } of READS) {
      describe(name, () => {
        it("is refused as unauthenticated to a call naming no user", async () => {
          await expect(
            read(new Nextly({ overrideAccess: false }), subjects)
          ).rejects.toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
        });

        for (const person of PEOPLE.filter(p => !allowed.includes(p))) {
          it(`is refused to ${person}, who lacks what REST asks`, async () => {
            await expect(
              read(checkedAs(person), subjects)
            ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
          });
        }

        for (const person of allowed) {
          it(`is made for ${person}, who holds what REST asks`, async () => {
            await expect(read(checkedAs(person), subjects)).resolves.toEqual(
              await read(trusted, subjects)
            );
          });
        }

        it("reads as before for trusted server code", async () => {
          // The control: the read finds what it names, so a refusal above is
          // the check's and not an empty or missing subject's.
          const found = await read(trusted, subjects);
          expect(found).toBeTruthy();
          if (Array.isArray(found)) expect(found.length).toBeGreaterThan(0);
          const listed = (found as { items?: unknown[] }).items;
          if (listed) expect(listed.length).toBeGreaterThan(0);
        });
      });
    }

    describe("which caller a call is checked as", () => {
      it("keeps an instance's check when a call leaves overrideAccess unset", async () => {
        await expect(
          checkedAs("lacker").users.find({ overrideAccess: undefined })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });

      it("checks one call that asks, on a trusted instance", async () => {
        await expect(
          trusted.users.find({
            overrideAccess: false,
            user: { id: ids.lacker },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });

      it("judges a key by its own scope, not its creator's grants", async () => {
        const key: AuthenticatedScope = {
          actorType: "apiKey",
          permissions: ["read-roles"],
        };
        const asKey = new Nextly({
          overrideAccess: false,
          user: { id: ids.reader },
          actor: key,
        });
        await expect(asKey.users.find()).rejects.toMatchObject({
          code: "FORBIDDEN",
          statusCode: 403,
        });
        await expect(asKey.roles.find()).resolves.toBeDefined();
      });

      it("refuses a media read naming a person and no key inside a keyed request", async () => {
        // As a media write does: judged as the person, the read would still
        // run under the request's key, and either could be the broader.
        const key: AuthenticatedScope = {
          actorType: "apiKey",
          permissions: ["read-media"],
        };
        await expect(
          runWithCallerScope(key, () => checkedAs("reader").media.find())
        ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      });
    });

    describe("an allowed read answers as REST answers the same person", () => {
      it("lists the users REST lists, with the same fields", async () => {
        const viaRest = await allowedBody<{ items: Record<string, unknown>[] }>(
          rest("reader", ["users"], "?limit=100")
        );
        const direct = await checkedAs("reader").users.find({ limit: 100 });
        expect(idsOf(direct.items)).toEqual(idsOf(viaRest.items as never));
        const fields = (item: object) =>
          Object.keys(JSON.parse(JSON.stringify(item)) as object).sort();
        for (const item of direct.items) {
          const same = viaRest.items.find(r => String(r.id) === item.id);
          expect(fields(item)).toEqual(fields(same ?? {}));
        }
      });

      it("reads one user with the fields REST reads", async () => {
        const viaRest = await allowedBody<Record<string, unknown>>(
          rest("reader", ["users", ids.lacker])
        );
        const direct = await checkedAs("reader").users.findByID({
          id: ids.lacker,
        });
        const fields = (item: object) =>
          Object.keys(JSON.parse(JSON.stringify(item)) as object).sort();
        expect(fields(direct ?? {})).toEqual(fields(viaRest));
        expect(fields(viaRest)).not.toContain("passwordHash");
      });

      it("lists the roles and permissions REST lists", async () => {
        const roles = await allowedBody<{ items: { id: string }[] }>(
          rest("reader", ["roles"], "?limit=100")
        );
        const directRoles = await checkedAs("reader").roles.find({
          limit: 100,
        });
        expect(idsOf(directRoles.items)).toEqual(idsOf(roles.items));

        const permissions = await allowedBody<{ items: { id: string }[] }>(
          rest("reader", ["permissions"], "?limit=100")
        );
        const directPermissions = await checkedAs("reader").permissions.find({
          limit: 100,
        });
        expect(idsOf(directPermissions.items)).toEqual(
          idsOf(permissions.items)
        );
      });

      it("lists a role's permissions as REST lists them", async () => {
        const viaRest = await allowedBody<{ permissions: { id: string }[] }>(
          rest("reader", ["roles", subjects.roleId, "permissions"])
        );
        const direct = await checkedAs("reader").roles.getPermissions({
          id: subjects.roleId,
        });
        expect(idsOf(direct)).toEqual(idsOf(viaRest.permissions));
      });

      it("lists the files and folders REST lists", async () => {
        const files = await allowedBody<{ items: { id: string }[] }>(
          restMedia("reader", [])
        );
        const directFiles = await checkedAs("reader").media.find();
        expect(idsOf(directFiles.items)).toEqual(idsOf(files.items));

        const folders = await allowedBody<{ folders: { id: string }[] }>(
          restMedia("reader", ["folders"])
        );
        const directFolders = await checkedAs("reader").media.folders.list();
        expect(idsOf(directFolders)).toEqual(idsOf(folders.folders));
      });

      it("lists the field groups REST lists", async () => {
        const viaRest = await allowedBody<{ items: { slug: string }[] }>(
          rest("reader", ["field-groups"])
        );
        const direct = await checkedAs("reader").fieldGroups.find();
        expect(direct.items.map(g => g.slug).sort()).toEqual(
          viaRest.items.map(g => g.slug).sort()
        );
      });

      it("refuses the person REST refuses, at each of these reads", async () => {
        // The other half of answering as REST does: the lacker is refused on
        // both doors, so the Direct API's refusals above are REST's.
        for (const segments of [["users"], ["roles"], ["permissions"]]) {
          expect(
            (await rest("lacker", segments)).status,
            segments.join("/")
          ).toBe(403);
        }
        expect((await restMedia("lacker", [])).status, "media").toBe(403);
        // And the one it serves anyone signed in, the lacker included.
        expect((await rest("lacker", ["field-groups"])).status).toBe(200);
      });
    });
  }
);
