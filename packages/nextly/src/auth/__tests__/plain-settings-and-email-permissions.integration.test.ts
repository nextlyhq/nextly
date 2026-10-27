/**
 * Settings and the Email hub are granted by plain permissions: create, read,
 * update and delete on `settings`, `email-providers` and `email-templates`.
 * Each exists, and each gate on those resources is passed by the plain
 * permission its action names. A schema change (a collection's or a Single's
 * definition) is a settings change of every kind at once, so it needs all
 * three of create, update and delete on settings.
 *
 * Each request is the admin's own, sent through the REST catch-all as a real
 * user with a real role. A gate that lets a caller through answers whatever
 * the request deserves past it (a 400 for an empty body, a 404 for a missing
 * id), never a 401 or 403; a gate that refuses answers 403.
 *
 * The controls: a role holding only `read-settings` is refused every change,
 * and a role holding the `manage-` permissions is still let through.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedAllPermissions } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import { getRBACService } from "../code-access";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";

type Headers = Record<string, string>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** The plain permissions settings and the Email hub are granted by. */
const PLAIN = [
  "create-settings",
  "read-settings",
  "update-settings",
  "delete-settings",
  "update-email-providers",
  "update-email-templates",
];

/** Every permission slug the install lists. */
async function listedSlugs(t: TestNextly): Promise<string[]> {
  const slugs: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    slugs.push(...found.items.map(p => p.slug));
    if (!found.meta.hasNext) return slugs;
  }
}

/** The ids of the permissions with these slugs; a missing one fails. */
async function permissionIds(t: TestNextly, slugs: string[]) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(
      ...found.items.filter(p => slugs.includes(p.slug)).map(p => String(p.id))
    );
    if (!found.meta.hasNext) break;
  }
  expect(ids).toHaveLength(slugs.length);
  return ids;
}

async function sessionFor(
  t: TestNextly,
  services: ServiceContainer,
  name: string,
  slugs: string[]
): Promise<Headers> {
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: await permissionIds(t, slugs) },
  });
  const roleId = String(role.item.id);
  const made = await t.nextly.users.create({
    email: `${name}@plain-settings.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${name}@plain-settings.test`,
      name,
      image: null,
      roleIds: [roleId],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}` };
}

/** One request through the REST catch-all, answered with its status. */
async function rest(
  method: Method,
  path: string,
  headers: Headers,
  body?: unknown
): Promise<number> {
  const segments = path.split("/").filter(Boolean);
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: segments }),
  });
  return res.status;
}

const REFUSED = [401, 403];

/** How often the rules of the collection named `settings` were asked. */
let settingsRuleAsks = 0;
/** Refuses everything, and counts the asks. */
const refuseAndCount = () => {
  settingsRuleAsks += 1;
  return false;
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`settings and email, by plain permission — ${dialect}`, () => {
    let t: TestNextly;
    /** May read, create, update and delete settings. */
    let settingsWriter: Headers;
    /** May read and update settings. */
    let settingsUpdater: Headers;
    /** May read settings. */
    let settingsReader: Headers;
    /** Each may read settings and do one change, the one named. */
    const only: Record<"create" | "update" | "delete", Headers> = {
      create: {},
      update: {},
      delete: {},
    };
    /** Each holds two of the three schema grants, missing the one named. */
    const missing: Record<"create" | "update" | "delete", Headers> = {
      create: {},
      update: {},
      delete: {},
    };
    /** May read and update email providers and templates. */
    let emailUpdater: Headers;
    /** Holds the `manage-` permissions on settings and email. */
    let manager: Headers;
    let templateId: string;
    let providerId: string;

    beforeAll(async () => {
      t = await createTestNextly({ dialect });
      try {
        const services = new ServiceContainer(t.adapter);
        // Access rules registered under the settings resource's name, as a
        // plugin's code could register them: they refuse everything, and a
        // settings or schema gate never asks them. (A collection or a Single
        // cannot take the name; it is reserved for the resource.)
        const rbac = getRBACService();
        // Without the service there would be nothing to register on, and the
        // case below would pass for the wrong reason.
        if (!rbac)
          throw new Error("the access-control service is not registered");
        rbac.registerCollectionAccess("settings", {
          read: refuseAndCount,
          create: refuseAndCount,
          update: refuseAndCount,
          delete: refuseAndCount,
        });
        await seedAllPermissions();
        // The first user an install makes is its super-admin, who passes
        // every check, so one is made before the users under test.
        await t.nextly.users.create({
          email: "root@plain-settings.test",
          password: "Password123!",
          data: { name: "root", isActive: true },
        });
        settingsWriter = await sessionFor(t, services, "settings-writer", [
          "read-settings",
          "create-settings",
          "update-settings",
          "delete-settings",
        ]);
        settingsUpdater = await sessionFor(t, services, "settings-updater", [
          "read-settings",
          "update-settings",
        ]);
        settingsReader = await sessionFor(t, services, "settings-reader", [
          "read-settings",
        ]);
        const changes = ["create", "update", "delete"] as const;
        for (const change of changes) {
          only[change] = await sessionFor(t, services, `only-${change}`, [
            "read-settings",
            `${change}-settings`,
          ]);
          missing[change] = await sessionFor(
            t,
            services,
            `missing-${change}`,
            changes
              .filter(other => other !== change)
              .map(other => `${other}-settings`)
          );
        }
        emailUpdater = await sessionFor(t, services, "email-updater", [
          "read-email-providers",
          "update-email-providers",
          "read-email-templates",
          "update-email-templates",
        ]);
        manager = await sessionFor(t, services, "manager", [
          "manage-settings",
          "manage-email-providers",
          "manage-email-templates",
        ]);
        const template = await t.nextly.emailTemplates.create({
          data: {
            name: "Newsletter",
            slug: "newsletter",
            subject: "News",
            htmlContent: "<p>News</p>",
          },
        });
        templateId = template.item.id;
        const provider = await t.nextly.emailProviders.create({
          data: {
            name: "Log",
            type: "log",
            fromEmail: "from@example.com",
            configuration: {},
          },
        });
        providerId = provider.item.id;
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists every plain settings and email permission", async () => {
      const listed = await listedSlugs(t);
      for (const slug of PLAIN) expect(listed).toContain(slug);
    });

    const IMAGE_SIZE_CHANGES: Array<
      [
        label: string,
        change: "create" | "update" | "delete",
        method: Method,
        path: string,
        body?: unknown,
      ]
    > = [
      ["creating an image size", "create", "POST", "image-sizes", {}],
      [
        "editing an image size",
        "update",
        "PATCH",
        "image-sizes/no-such-size",
        {},
      ],
      [
        "deleting an image size",
        "delete",
        "DELETE",
        "image-sizes/no-such-size",
      ],
    ];

    for (const [label, change, method, path, body] of IMAGE_SIZE_CHANGES) {
      it(`lets a caller who may change settings go on to ${label}`, async () => {
        expect(REFUSED).not.toContain(
          await rest(method, path, settingsWriter, body)
        );
        // That change's own permission alone lets a caller through, and
        // either of the other two does not.
        expect(REFUSED).not.toContain(
          await rest(method, path, only[change], body)
        );
        for (const other of ["create", "update", "delete"] as const) {
          if (other === change) continue;
          expect(await rest(method, path, only[other], body), other).toBe(403);
        }
        // The controls: a reader is refused, a manager let through.
        expect(await rest(method, path, settingsReader, body)).toBe(403);
        expect(REFUSED).not.toContain(await rest(method, path, manager, body));
      });
    }

    it("lets a caller who may update settings change the general settings and the sidebar", async () => {
      for (const [method, path] of [
        ["PATCH", "general-settings"],
        ["PATCH", "admin-meta/sidebar-groups"],
      ] as const) {
        expect(REFUSED).not.toContain(
          await rest(method, path, settingsUpdater, {})
        );
        expect(await rest(method, path, settingsReader, {})).toBe(403);
      }
    });

    const SCHEMA_CHANGES: Array<[label: string, path: string]> = [
      ["define a collection", "collections"],
      ["define a Single", "singles"],
    ];

    for (const [label, path] of SCHEMA_CHANGES) {
      it(`asks create, update and delete on settings to ${label}`, async () => {
        expect(REFUSED).not.toContain(
          await rest("POST", path, settingsWriter, {})
        );
        // Updating settings alone does not reach the schema, nor do any two
        // of the three.
        expect(await rest("POST", path, settingsUpdater, {})).toBe(403);
        for (const change of ["create", "update", "delete"] as const) {
          expect(await rest("POST", path, missing[change], {}), change).toBe(
            403
          );
        }
        expect(REFUSED).not.toContain(await rest("POST", path, manager, {}));
      });
    }

    it("asks a schema change no rule registered under the settings name", async () => {
      // The schema grants are settings permissions, not the operations of an
      // entity that shares their name: those rules refuse everything, and are
      // never asked.
      settingsRuleAsks = 0;
      for (const [, path] of SCHEMA_CHANGES) {
        expect(REFUSED).not.toContain(
          await rest("POST", path, settingsWriter, {})
        );
      }
      expect(settingsRuleAsks).toBe(0);
    });

    it("lets a caller who may update email providers and templates edit them", async () => {
      for (const path of [
        `email-providers/${providerId}`,
        `email-templates/${templateId}`,
      ]) {
        expect(REFUSED).not.toContain(
          await rest("PATCH", path, emailUpdater, { name: "Changed" })
        );
        expect(REFUSED).toContain(
          await rest("PATCH", path, settingsReader, { name: "Changed" })
        );
      }
    });
  });
}
