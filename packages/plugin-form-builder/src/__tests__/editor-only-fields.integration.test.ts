/**
 * A form's notification rules name who is emailed, and its internal note is
 * for the people who manage it, so only they read either: a visitor reading
 * the form, alone or in the public list, gets the form without them, and so
 * does staff who can only read forms. Staff who can edit forms and the
 * super-admin read both, since a field they could save but not read would
 * be saved back empty. Sending reads the form as the system and still finds
 * the rules.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Direct {
  users: {
    create: (a: {
      email: string;
      password: string;
      data: Record<string, unknown>;
    }) => Promise<{ item: { id: string } }>;
  };
  permissions: {
    find: (a: { limit: number }) => Promise<{
      items: { id: string; slug: string }[];
    }>;
  };
  roles: {
    create: (a: { data: Record<string, unknown> }) => Promise<{
      item: { id: string };
    }>;
  };
}

const RECIPIENT = "team@example.com";
const NOTE = "Lahore meetup, 6 December.";
const NOTIFICATIONS = [
  { name: "Team", enabled: true, recipientType: "static", to: RECIPIENT },
];

/** The catch-all's params for a `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
    // The Public role a visitor is judged by holds what a real boot grants it,
    // the read of a form among it.
    seedPublic: true,
  });
  const { nextly } = current;
  const direct = nextly as unknown as Direct;

  // The install's first user holds super-admin.
  const owner = await direct.users.create({
    email: "owner@example.com",
    password: "Password123!",
    data: { name: "Owner", isActive: true },
  });

  const seeded = (await direct.permissions.find({ limit: 1000 })).items;
  /** A signed-in staff member whose one role holds exactly `slugs`. */
  async function staffHolding(label: string, slugs: string[]) {
    const permissionIds = slugs.map(slug => {
      const found = seeded.find(permission => permission.slug === slug);
      if (!found) throw new Error(`boot seeded no ${slug}`);
      return String(found.id);
    });
    const role = await direct.roles.create({
      data: { name: `Holds ${label}`, slug: `holds-${label}`, permissionIds },
    });
    const user = await direct.users.create({
      email: `${label}@example.com`,
      password: "Password123!",
      data: { name: label, isActive: true, roles: [role.item.id] },
    });
    return { id: user.item.id };
  }

  await nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: [{ type: "email", name: "email", label: "Email" }],
      notifications: NOTIFICATIONS,
      settings: { internalNote: NOTE },
    },
  });

  return {
    nextly,
    owner: { id: owner.item.id },
    staffHolding,
    handlers: createDynamicHandlers(),
  };
}

/** The forms a caller reads, judged as that caller. */
async function formsReadBy(
  nextly: TestNextly["nextly"],
  user?: { id: string }
) {
  const { items } = await nextly.find({
    collection: "forms",
    overrideAccess: false,
    ...(user ? { user } : {}),
  });
  return items as Record<string, unknown>[];
}

describe.each(getConfiguredTestDialects())(
  "who reads a form's notifications (%s)",
  dialect => {
    it("is not a visitor reading the form at its public address", async () => {
      const { handlers } = await boot(dialect);
      const res = await handlers.GET(
        new Request("http://localhost/api/forms/contact"),
        params("forms", "contact")
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // The form itself is still served.
      expect(body.slug).toBe("contact");
      expect(body).not.toHaveProperty("notifications");
      expect(JSON.stringify(body)).not.toContain(RECIPIENT);
      expect(JSON.stringify(body)).not.toContain(NOTE);
    });

    it("is not a visitor reading the public list", async () => {
      const { handlers } = await boot(dialect);
      const res = await handlers.GET(
        new Request("http://localhost/api/forms"),
        params("forms")
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Record<string, unknown>[] };
      expect(body.items).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain(RECIPIENT);
      expect(JSON.stringify(body)).not.toContain(NOTE);
    });

    it("is not staff who can only read forms", async () => {
      const { nextly, staffHolding } = await boot(dialect);
      const reader = await staffHolding("forms-reader", ["read-forms"]);
      const [form] = await formsReadBy(nextly, reader);
      expect(form?.slug).toBe("contact");
      expect(form).not.toHaveProperty("notifications");
      expect(JSON.stringify(form)).not.toContain(NOTE);
    });

    it("is staff who can edit forms, and the super-admin, who read the note too", async () => {
      const { nextly, owner, staffHolding } = await boot(dialect);
      const editor = await staffHolding("forms-editor", [
        "read-forms",
        "update-forms",
      ]);
      const read = async (user: { id: string }) => {
        const [form] = await formsReadBy(nextly, user);
        const settings = form?.settings as
          | { internalNote?: string }
          | undefined;
        return {
          notifications: form?.notifications ?? null,
          note: settings?.internalNote ?? null,
        };
      };
      const expected = { notifications: NOTIFICATIONS, note: NOTE };
      expect({ editor: await read(editor), owner: await read(owner) }).toEqual({
        editor: expected,
        owner: expected,
      });
    });
  }
);
