/**
 * Real records for a template's test data: an owner offers them beside its
 * template, and the workbench reads them through
 * `GET /api/email-templates/{id}/sample-records` and
 * `GET /api/email-templates/{id}/sample-records/{recordId}`.
 *
 * A record is offered only to a person allowed to read it: Nextly checks the
 * caller may read what the loader says it reads before the loader runs, so a
 * caller refused never reaches it. A record is read for the preview and kept
 * nowhere.
 *
 * Through the REST catch-all as real users with real roles, on every dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { seedAllPermissions } from "../../../init/seed-permissions";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { EmailTemplateService } from "../services/email-template-service";

const ORIGIN = "http://localhost";
const REFUSED = [401, 403];
const ORDERS = "sample_orders";
const SHIPPED = "sample-order-shipped";
/** Orders a rule lets each person read only some of. */
const OWN_ORDERS = "sample_own_orders";
const OWN_SHIPPED = "sample-own-order-shipped";
/** Orders with a field only some may read. */
const NOTED_ORDERS = "sample_noted_orders";
const NOTED_SHIPPED = "sample-noted-order-shipped";
/** Orders whose rule sits in a field group they hold. */
const GROUPED_ORDERS = "sample_grouped_orders";
const GROUPED_SHIPPED = "sample-grouped-order-shipped";

type Headers = Record<string, string>;

/** Every call each loader was handed, by loader. */
const loaderCalls: string[] = [];

/** The shop's template, offering its orders as real records. */
const shippedTemplate = {
  slug: SHIPPED,
  name: "Order shipped",
  subject: "Order {{ orderNumber }} is on its way",
  htmlContent: "<p>Hi {{ customer }}, order {{ orderNumber }} shipped.</p>",
  variables: [
    { name: "orderNumber", type: "text", example: "A-100" },
    { name: "customer", type: "text", example: "Sam" },
  ],
  sampleRecords: {
    label: "A real order",
    reads: { collection: ORDERS },
    list: async ({ limit }: { limit: number }) => {
      loaderCalls.push(`list:${limit}`);
      return [
        { id: "o-1", label: "Order A-1" },
        { id: "o-2", label: "Order A-2" },
      ];
    },
    load: async (id: string) => {
      loaderCalls.push(`load:${id}`);
      if (id === "gone") return null;
      // Under 64 KB in UTF-16 code units, over it in the UTF-8 bytes sent.
      if (id === "large") return { customer: "数".repeat(25_000) };
      return { orderNumber: id.toUpperCase(), customer: "Ada" };
    },
  },
} as unknown as PluginEmailTemplate;

/** A template offering the orders a read rule filters. */
const ownShippedTemplate = {
  ...shippedTemplate,
  slug: OWN_SHIPPED,
  name: "Own order shipped",
  sampleRecords: {
    label: "A real order of yours",
    reads: { collection: OWN_ORDERS },
    list: async () => {
      loaderCalls.push("own-list");
      return [{ id: "o-9", label: "Order A-9" }];
    },
    load: async (id: string) => {
      loaderCalls.push(`own-load:${id}`);
      return { orderNumber: id, customer: "Someone else" };
    },
  },
} as unknown as PluginEmailTemplate;

const shop = definePlugin({
  name: "sample-shop",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({
        slug: ORDERS,
        fields: [text({ name: "number" }), text({ name: "customer" })],
      }),
    ],
  },
} as never);

/** A template offering the orders whose note a field rule keeps from most. */
const notedShippedTemplate = {
  ...shippedTemplate,
  slug: NOTED_SHIPPED,
  name: "Noted order shipped",
  sampleRecords: {
    label: "A real noted order",
    reads: { collection: NOTED_ORDERS },
    list: async () => {
      loaderCalls.push("noted-list");
      return [{ id: "o-7", label: "Order A-7" }];
    },
    load: async (id: string) => {
      loaderCalls.push(`noted-load:${id}`);
      return { orderNumber: id, customer: "the note nobody may read" };
    },
  },
} as unknown as PluginEmailTemplate;

/** A template offering the orders holding a group whose field has a rule. */
const groupedShippedTemplate = {
  ...shippedTemplate,
  slug: GROUPED_SHIPPED,
  name: "Grouped order shipped",
  sampleRecords: {
    label: "A real grouped order",
    reads: { collection: GROUPED_ORDERS },
    list: async () => {
      loaderCalls.push("grouped-list");
      return [{ id: "o-5", label: "Order A-5" }];
    },
    load: async (id: string) => {
      loaderCalls.push(`grouped-load:${id}`);
      return { orderNumber: id, customer: "the group's note" };
    },
  },
} as unknown as PluginEmailTemplate;

/** A group whose note a field read rule keeps from everyone. */
const orderNotes = defineFieldGroup({
  slug: "sample-order-notes",
  fields: [text({ name: "note", access: { read: () => false } })],
});

/** Orders holding that group, with no rule of their own. */
const groupedOrders = defineCollection({
  slug: GROUPED_ORDERS,
  fields: [
    text({ name: "number" }),
    fieldGroup({ name: "notes", component: "sample-order-notes" }),
  ],
});

/** Orders whose note a field read rule keeps from everyone. */
const notedOrders = defineCollection({
  slug: NOTED_ORDERS,
  fields: [
    text({ name: "number" }),
    text({ name: "note", access: { read: () => false } }),
  ],
});

/** Orders each person reads only the ones a read rule's filter matches of. */
const ownOrders = defineCollection({
  slug: OWN_ORDERS,
  fields: [text({ name: "number" }), text({ name: "customer" })],
  access: { read: () => ({ customer: { equals: "reader" } }) },
});

async function permissionIds(t: TestNextly, slugs: string[]) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(
      ...found.items.filter(p => slugs.includes(p.slug)).map(p => String(p.id))
    );
    if (!found.meta.hasNext) return ids;
  }
}

async function tokenFor(
  id: string,
  name: string,
  roleIds: string[]
): Promise<Headers> {
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${name}@records.test`,
      name,
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}` };
}

async function sessionFor(
  t: TestNextly,
  services: ServiceContainer,
  name: string,
  slugs: string[]
): Promise<{ headers: Headers; id: string }> {
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: await permissionIds(t, slugs) },
  });
  const roleId = String(role.item.id);
  const made = await t.nextly.users.create({
    email: `${name}@records.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  return { headers: await tokenFor(id, name, [roleId]), id };
}

/** One GET through the REST catch-all, as the admin sends it. */
async function get(
  path: string,
  headers: Headers
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${path}`, {
      method: "GET",
      headers: { origin: ORIGIN, ...headers },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text };
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`real records for a template's test data — ${dialect}`, () => {
    let t: TestNextly;
    let reader: Headers;
    let templatesOnly: Headers;
    let usersOnly: Headers;
    let shippedId: string;
    let ownShippedId: string;
    let notedShippedId: string;
    let groupedShippedId: string;
    let welcomeId: string;
    let adaId: string;

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [shop],
        collections: [ownOrders, notedOrders, groupedOrders],
        fieldGroups: [orderNotes],
      });
      try {
        const services = new ServiceContainer(t.adapter);
        await seedAllPermissions();
        // The install's first account, which core makes super-admin, so
        // every person below is judged by the permissions their role holds.
        await t.nextly.users.create({
          email: "owner@records.test",
          password: "Password123!",
          data: { name: "Owner", isActive: true },
        });
        ({ headers: reader } = await sessionFor(t, services, "reader", [
          "read-email-templates",
          `read-${ORDERS}`,
          `read-${OWN_ORDERS}`,
          `read-${NOTED_ORDERS}`,
          `read-${GROUPED_ORDERS}`,
          "read-users",
        ]));
        ({ headers: templatesOnly } = await sessionFor(
          t,
          services,
          "templates-only",
          ["read-email-templates"]
        ));
        ({ headers: usersOnly } = await sessionFor(t, services, "users-only", [
          `read-${ORDERS}`,
          "read-users",
        ]));
        const ada = await t.nextly.users.create({
          email: "ada@records.test",
          password: "Password123!",
          data: { name: "Ada Lovelace", isActive: true },
        });
        adaId = String((ada.item as { id: string | number }).id);

        // The shop's template registered as its running owner's.
        const templates = t.getService(
          "emailTemplateService"
        ) as unknown as EmailTemplateService;
        templates.configureOwnership({
          plugins: [
            {
              name: "sample-shop",
              templates: [
                shippedTemplate,
                ownShippedTemplate,
                notedShippedTemplate,
                groupedShippedTemplate,
              ],
            },
          ],
        });
        await templates.ensureBuiltInTemplates();

        const shipped = await t.nextly.emailTemplates.findBySlug({
          slug: SHIPPED,
        });
        const welcome = await t.nextly.emailTemplates.findBySlug({
          slug: "welcome",
        });
        const ownShipped = await t.nextly.emailTemplates.findBySlug({
          slug: OWN_SHIPPED,
        });
        const notedShipped = await t.nextly.emailTemplates.findBySlug({
          slug: NOTED_SHIPPED,
        });
        const groupedShipped = await t.nextly.emailTemplates.findBySlug({
          slug: GROUPED_SHIPPED,
        });
        if (
          !shipped ||
          !welcome ||
          !ownShipped ||
          !notedShipped ||
          !groupedShipped
        ) {
          throw new Error("templates not seeded");
        }
        shippedId = String(shipped.id);
        ownShippedId = String(ownShipped.id);
        notedShippedId = String(notedShipped.id);
        groupedShippedId = String(groupedShipped.id);
        welcomeId = String(welcome.id);
      } catch (error) {
        await t?.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("lists an owner's real records, and loads one's variables, for a person who may read them", async () => {
      loaderCalls.length = 0;
      const list = await get(
        `email-templates/${shippedId}/sample-records`,
        reader
      );
      expect(list.status, list.text).toBe(200);
      expect(list.body).toMatchObject({
        items: [
          { id: "o-1", label: "Order A-1" },
          { id: "o-2", label: "Order A-2" },
        ],
        meta: expect.objectContaining({ label: "A real order" }),
      });

      const one = await get(
        `email-templates/${shippedId}/sample-records/o-1`,
        reader
      );
      expect(one.status, one.text).toBe(200);
      expect(one.body).toMatchObject({
        variables: { orderNumber: "O-1", customer: "Ada" },
      });
      expect(loaderCalls).toEqual([
        expect.stringMatching(/^list:\d+$/),
        "load:o-1",
      ]);
    });

    it("answers not found for a record the loader no longer has", async () => {
      const gone = await get(
        `email-templates/${shippedId}/sample-records/gone`,
        reader
      );
      expect(gone.status, gone.text).toBe(404);
    });

    it("refuses a person who can't read what the loader reads, before the loader runs", async () => {
      loaderCalls.length = 0;
      for (const path of [
        `email-templates/${shippedId}/sample-records`,
        `email-templates/${shippedId}/sample-records/o-1`,
      ]) {
        // Allowed to read templates, not orders.
        expect(REFUSED, path).toContain(
          (await get(path, templatesOnly)).status
        );
        // Allowed to read orders, not templates.
        expect(REFUSED, path).toContain((await get(path, usersOnly)).status);
        // Nobody signed in.
        expect(REFUSED, path).toContain((await get(path, {})).status);
      }
      expect(loaderCalls).toEqual([]);
    });

    it("refuses a person whose read a rule's filter limits, before the loader runs: it would read past the filter", async () => {
      loaderCalls.length = 0;
      for (const path of [
        `email-templates/${ownShippedId}/sample-records`,
        `email-templates/${ownShippedId}/sample-records/o-9`,
      ]) {
        // Holds the read, which the rule's filter limits to some orders.
        const refused = await get(path, reader);
        expect(REFUSED, `${path}: ${refused.text}`).toContain(refused.status);
      }
      expect(loaderCalls).toEqual([]);
    });

    it("refuses a person reading a collection whose fields carry a read rule, before the loader runs: it would read past the rule", async () => {
      loaderCalls.length = 0;
      for (const path of [
        `email-templates/${notedShippedId}/sample-records`,
        `email-templates/${notedShippedId}/sample-records/o-7`,
      ]) {
        // Holds the collection's read, which a field's own rule narrows.
        const refused = await get(path, reader);
        expect(REFUSED, `${path}: ${refused.text}`).toContain(refused.status);
      }
      expect(loaderCalls).toEqual([]);
    });

    it("refuses a person reading a collection that holds a group whose field carries a rule", async () => {
      loaderCalls.length = 0;
      const refused = await get(
        `email-templates/${groupedShippedId}/sample-records`,
        reader
      );
      expect(REFUSED, refused.text).toContain(refused.status);
      expect(loaderCalls).toEqual([]);
    });

    it("refuses a record larger than 64 KB as sent, counted in bytes", async () => {
      const large = await get(
        `email-templates/${shippedId}/sample-records/large`,
        reader
      );
      expect(large.status, large.text).toBe(500);
      expect(large.text).not.toContain("数数数");
    });

    it("offers core's user emails a real user, to a person who may read users", async () => {
      const list = await get(
        `email-templates/${welcomeId}/sample-records`,
        reader
      );
      expect(list.status, list.text).toBe(200);
      const items = list.body.items as Array<{ id: string; label: string }>;
      expect(items.map(item => item.id)).toContain(adaId);

      const one = await get(
        `email-templates/${welcomeId}/sample-records/${adaId}`,
        reader
      );
      expect(one.status, one.text).toBe(200);
      expect(one.body).toMatchObject({
        variables: { userName: "Ada Lovelace", userEmail: "ada@records.test" },
      });

      // Reading users is the access asked, not reading templates alone.
      expect(REFUSED).toContain(
        (
          await get(
            `email-templates/${welcomeId}/sample-records`,
            templatesOnly
          )
        ).status
      );
    });

    it("answers not found for a template whose owner offers no records", async () => {
      const layout = await t.nextly.emailTemplates.findBySlug({
        slug: "default-layout",
      });
      const id = layout ? String(layout.id) : "missing";
      const none = await get(`email-templates/${id}/sample-records`, reader);
      expect(none.status, none.text).toBe(404);
    });

    it("stores nothing of a record it reads", async () => {
      const before = await t.nextly.emailTemplates.findBySlug({
        slug: SHIPPED,
      });
      await get(`email-templates/${shippedId}/sample-records/o-2`, reader);
      const after = await t.nextly.emailTemplates.findBySlug({ slug: SHIPPED });
      expect(after).toEqual(before);
      expect(JSON.stringify(after)).not.toContain("O-2");
    });
  });
}
