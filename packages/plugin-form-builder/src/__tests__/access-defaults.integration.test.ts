/**
 * form-builder's default access rules, judged by the real access gate.
 *
 * The gate checks the caller's permission before a collection's code rule,
 * and the rule only narrows it. The defaults check the permission for the
 * operation too, and these tests hold the outcome through the gate on each
 * configured dialect: a role without the permission is refused, a role with
 * it is admitted, and the two public axes — reading a form, creating a
 * submission — stay open to a visitor.
 *
 * The roles are named for what they hold, never `admin` or `editor`, so a
 * default that still decided by role name could not pass the admitted cases.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The part of the Direct API these tests drive, typed where the shim is not. */
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

/**
 * The permissions the defaults are judged against, as boot's seeding stores
 * them, `<action>-<resource>`. `read-forms` is what the role without any of
 * the others holds, since a role must hold at least one permission.
 */
const PERMISSIONS = [
  { action: "read", resource: "forms" },
  { action: "update", resource: "forms" },
  { action: "read", resource: "form-submissions" },
  { action: "delete", resource: "form-submissions" },
] as const;

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
    // The boot's seeding, so the Public role a visitor is judged by holds what
    // a real boot grants it: the read of a form, and the plugin's submission
    // create.
    seedPublic: true,
  });
  const { nextly } = current;
  const direct = nextly as unknown as Direct;

  // Seeded by the boot, so each is looked up rather than written here.
  const seeded = (await direct.permissions.find({ limit: 1000 })).items;
  const ids = new Map<string, string>();
  for (const { action, resource } of PERMISSIONS) {
    const slug = `${action}-${resource}`;
    const found = seeded.find(permission => permission.slug === slug);
    if (!found) throw new Error(`boot seeded no ${slug}`);
    ids.set(slug, String(found.id));
  }

  // The install's first user holds super-admin, so it is made first and kept
  // out of every case below: a super-admin passes every rule.
  await direct.users.create({
    email: "owner@example.com",
    password: "Password123!",
    data: { name: "Owner", isActive: true },
  });

  /** A signed-in staff member whose one role holds exactly `slugs`. */
  async function staffHolding(label: string, slugs: string[]) {
    const role = await direct.roles.create({
      data: {
        name: `Holds ${label}`,
        slug: `holds-${label}`,
        permissionIds: slugs.map(slug => ids.get(slug)!),
      },
    });
    const user = await direct.users.create({
      email: `${label}@example.com`,
      password: "Password123!",
      data: { name: label, isActive: true, roles: [role.item.id] },
    });
    return { id: user.item.id };
  }

  const form = await nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: [{ type: "text", name: "message", label: "Message" }],
    },
  });
  const formId = form.item.id;
  const submission = await nextly.create({
    collection: "form-submissions",
    data: {
      form: formId,
      data: { message: "private" },
      status: "new",
      submittedAt: new Date().toISOString(),
    },
  });
  const submissionId = submission.item.id;

  return { nextly, staffHolding, formId, submissionId };
}

/** Whether the call was refused by the access gate rather than answered. */
async function refused(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) return true;
    throw error;
  }
}

describe.each(getConfiguredTestDialects())(
  "form-builder default access (%s)",
  dialect => {
    it("refuses submissions to a signed-in user without read-form-submissions", async () => {
      const { nextly, staffHolding } = await boot(dialect);
      const staff = await staffHolding("forms-only", ["read-forms"]);

      expect(
        await refused(() =>
          nextly.find({
            collection: "form-submissions",
            overrideAccess: false,
            user: staff,
          })
        )
      ).toBe(true);
    });

    it("gives submissions to a signed-in user holding read-form-submissions", async () => {
      const { nextly, staffHolding, submissionId } = await boot(dialect);
      const reviewer = await staffHolding("submission-reader", [
        "read-form-submissions",
      ]);

      const found = await nextly.find({
        collection: "form-submissions",
        overrideAccess: false,
        user: reviewer,
      });
      expect(found.items.map(item => (item as { id: string }).id)).toEqual([
        submissionId,
      ]);
    });

    it("refuses submissions to a visitor", async () => {
      const { nextly } = await boot(dialect);

      expect(
        await refused(() =>
          nextly.find({ collection: "form-submissions", overrideAccess: false })
        )
      ).toBe(true);
    });

    it("refuses a form edit to a signed-in user without update-forms", async () => {
      const { nextly, staffHolding, formId } = await boot(dialect);
      const staff = await staffHolding("forms-reader", ["read-forms"]);

      expect(
        await refused(() =>
          nextly.update({
            collection: "forms",
            id: formId,
            data: { name: "Renamed" },
            overrideAccess: false,
            user: staff,
          })
        )
      ).toBe(true);
    });

    it("lets a signed-in user holding update-forms edit a form", async () => {
      const { nextly, staffHolding, formId } = await boot(dialect);
      const editor = await staffHolding("forms-editor", [
        "read-forms",
        "update-forms",
      ]);

      const updated = await nextly.update({
        collection: "forms",
        id: formId,
        data: { name: "Renamed" },
        overrideAccess: false,
        user: editor,
      });
      expect((updated.item as { name?: string }).name).toBe("Renamed");
    });

    it("lets a signed-in user delete a submission only with delete-form-submissions", async () => {
      const { nextly, staffHolding, submissionId } = await boot(dialect);
      const reader = await staffHolding("reader", ["read-form-submissions"]);
      const deleter = await staffHolding("deleter", [
        "read-form-submissions",
        "delete-form-submissions",
      ]);

      expect(
        await refused(() =>
          nextly.delete({
            collection: "form-submissions",
            id: submissionId,
            overrideAccess: false,
            user: reader,
          })
        )
      ).toBe(true);

      await nextly.delete({
        collection: "form-submissions",
        id: submissionId,
        overrideAccess: false,
        user: deleter,
      });
      const left = await nextly.find({ collection: "form-submissions" });
      expect(left.items).toHaveLength(0);
    });

    it("keeps a form readable, and a submission creatable, by a visitor", async () => {
      const { nextly, formId } = await boot(dialect);

      const forms = await nextly.find({
        collection: "forms",
        overrideAccess: false,
      });
      expect(forms.items.map(item => (item as { id: string }).id)).toEqual([
        formId,
      ]);

      const created = await nextly.create({
        collection: "form-submissions",
        data: {
          form: formId,
          data: { message: "from a visitor" },
          status: "new",
          submittedAt: new Date().toISOString(),
        },
        overrideAccess: false,
      });
      expect(created.item.id).toBeTruthy();
    });
  }
);
