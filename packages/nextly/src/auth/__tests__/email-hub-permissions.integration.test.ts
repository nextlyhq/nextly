/**
 * The Email hub shows its lists to a reader holding only the read grants, so
 * every change it offers must be refused at the API for that reader, not only
 * hidden. Each case sends the admin's own request through the REST catch-all
 * as a real user with a real role.
 *
 * The controls: a manager is allowed what the reader is refused, and a user
 * with no email grant is refused even the lists.
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
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";

type Headers = Record<string, string>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

/** The ids of the permissions with these slugs. */
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
    email: `${name}@email-hub.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${name}@email-hub.test`,
      name,
      image: null,
      roleIds: [roleId],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}` };
}

/** One request through the REST catch-all, as the admin sends it. */
function rest(
  method: Method,
  path: string,
  headers: Headers,
  body?: unknown
): Promise<Response> {
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
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

const REFUSED = [401, 403];

for (const dialect of getConfiguredTestDialects()) {
  describe(`the Email hub's changes, by grant — ${dialect}`, () => {
    let t: TestNextly;
    let reader: Headers;
    let manager: Headers;
    let stranger: Headers;
    let templateId: string;
    let providerId: string;

    beforeAll(async () => {
      t = await createTestNextly({ dialect });
      try {
        const services = new ServiceContainer(t.adapter);
        await seedAllPermissions();
        // The first user an install makes is its super-admin, who passes
        // every check, so one is made before the users under test.
        await t.nextly.users.create({
          email: "root@email-hub.test",
          password: "Password123!",
          data: { name: "root", isActive: true },
        });
        reader = await sessionFor(t, services, "reader", [
          "read-email-templates",
          "read-email-providers",
        ]);
        manager = await sessionFor(t, services, "manager", [
          "manage-email-templates",
          "manage-email-providers",
        ]);
        stranger = await sessionFor(t, services, "stranger", ["read-users"]);
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

    it("lets a reader see the emails and the providers", async () => {
      expect((await rest("GET", "email-templates", reader)).status).toBe(200);
      expect((await rest("GET", "email-providers", reader)).status).toBe(200);
    });

    it("refuses a user with no email grant even the lists", async () => {
      expect(REFUSED).toContain(
        (await rest("GET", "email-templates", stranger)).status
      );
      expect(REFUSED).toContain(
        (await rest("GET", "email-providers", stranger)).status
      );
    });

    const TEMPLATE_CHANGES: Array<
      [label: string, method: Method, path: () => string, body?: unknown]
    > = [
      [
        "creating an email",
        "POST",
        () => "email-templates",
        {
          name: "Promo",
          slug: "promo",
          subject: "Promo",
          htmlContent: "<p>Promo</p>",
        },
      ],
      [
        "editing an email",
        "PATCH",
        () => `email-templates/${templateId}`,
        { subject: "Changed" },
      ],
      [
        "previewing an email",
        "POST",
        () => `email-templates/${templateId}/preview`,
        { sampleData: {} },
      ],
      ["deleting an email", "DELETE", () => `email-templates/${templateId}`],
    ];

    const PROVIDER_CHANGES: Array<
      [label: string, method: Method, path: () => string, body?: unknown]
    > = [
      [
        "adding a provider",
        "POST",
        () => "email-providers",
        {
          name: "Another",
          type: "log",
          fromEmail: "from@example.com",
          configuration: {},
        },
      ],
      [
        "editing a provider",
        "PATCH",
        () => `email-providers/${providerId}`,
        { name: "Renamed" },
      ],
      [
        "making a provider the default",
        "PATCH",
        () => `email-providers/${providerId}/default`,
      ],
      [
        "sending a test from a provider",
        "POST",
        () => `email-providers/${providerId}/test`,
        {},
      ],
      ["deleting a provider", "DELETE", () => `email-providers/${providerId}`],
    ];

    it.each([...TEMPLATE_CHANGES, ...PROVIDER_CHANGES])(
      "refuses a reader %s",
      async (_label, method, path, body) => {
        const response = await rest(method, path(), reader, body);
        expect(REFUSED).toContain(response.status);
      }
    );

    it("allows a manager what it refuses the reader", async () => {
      // One change of each kind, in an order that leaves both rows in place.
      const edited = await rest(
        "PATCH",
        `email-templates/${templateId}`,
        manager,
        { subject: "Changed" }
      );
      expect(edited.status).toBe(200);
      const renamed = await rest(
        "PATCH",
        `email-providers/${providerId}`,
        manager,
        { name: "Renamed" }
      );
      expect(renamed.status).toBe(200);
    });
  });
}
