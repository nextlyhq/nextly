/**
 * An edit onto an email address another submission of a form taking one
 * response per email already holds, on every dialect: refused, naming the
 * other submission to a staff member who may read submissions and saying
 * only that the address is used to one who may update but not read them.
 * An edit to a free address goes through.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

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

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect) {
  current = await createTestNextly({
    dialect,
    plugins: [formBuilder().plugin],
    seedPublic: true,
  });
  const t = current;
  const direct = t.nextly as unknown as Direct;
  const form = await t.nextly.create({
    collection: "forms",
    data: {
      name: "Meetup",
      slug: "meetup",
      status: "published",
      fields: [
        { type: "email", name: "email", label: "Email", required: true },
      ],
      settings: { oneResponse: "email", oneResponseField: "email" },
    },
  });
  const submit = async (email: string) =>
    String(
      (
        await t.nextly.create({
          collection: "form-submissions",
          data: {
            form: form.item.id,
            data: { email },
            submittedAt: new Date().toISOString(),
          },
        })
      ).item.id
    );

  // The install's first user holds super-admin, which passes every rule, so
  // it is made first and kept out of the cases.
  await direct.users.create({
    email: "owner@example.com",
    password: "Password123!",
    data: { name: "Owner", isActive: true },
  });
  const seeded = (await direct.permissions.find({ limit: 1000 })).items;
  /** A signed-in staff member whose one role holds exactly `slugs`. */
  const staff = async (label: string, slugs: string[]) => {
    const role = await direct.roles.create({
      data: {
        name: `Holds ${label}`,
        slug: `holds-${label}`,
        permissionIds: slugs.map(slug => {
          const found = seeded.find(permission => permission.slug === slug);
          if (!found) throw new Error(`boot seeded no ${slug}`);
          return String(found.id);
        }),
      },
    });
    const user = await direct.users.create({
      email: `${label}@example.com`,
      password: "Password123!",
      data: { name: label, isActive: true, roles: [role.item.id] },
    });
    // As a signed-in request carries its user: the id and the email.
    return { id: user.item.id, email: `${label}@example.com` };
  };

  const editAs = (
    user: { id: string; email: string },
    id: string,
    email: string
  ) =>
    t.nextly.update({
      collection: "form-submissions",
      id,
      data: { data: { email }, _overwrite: true },
      overrideAccess: false,
      user,
    });

  return { submit, staff, editAs };
}

describe.each(getConfiguredTestDialects())(
  "an edit onto a taken address (%s)",
  dialect => {
    it("names the other submission to a person who may read it", async () => {
      const { submit, staff, editAs } = await boot(dialect);
      const ada = await submit("ada@example.com");
      const grace = await submit("grace@example.com");
      const reader = await staff("reader", [
        "read-form-submissions",
        "update-form-submissions",
      ]);

      await expect(
        editAs(reader, ada, "Grace@example.com")
      ).rejects.toMatchObject({
        code: "DUPLICATE",
        publicMessage: `This email address is already used by submission ${grace} of this form.`,
      });
      // The control: an edit to a free address goes through.
      await expect(
        editAs(reader, ada, "ada@lovelace.dev")
      ).resolves.toBeTruthy();
    });

    it("says only that the address is used to one who may not read submissions", async () => {
      const { submit, staff, editAs } = await boot(dialect);
      const ada = await submit("ada@example.com");
      const grace = await submit("grace@example.com");
      const updater = await staff("updater", ["update-form-submissions"]);

      const refusal = await editAs(updater, ada, "grace@example.com").then(
        () => undefined,
        (error: unknown) =>
          error as {
            code?: string;
            publicMessage?: string;
            publicData?: unknown;
          }
      );
      expect(refusal).toMatchObject({
        code: "DUPLICATE",
        publicMessage:
          "This email address is already used by another submission of this form.",
      });
      // Nothing a client is sent names the other submission.
      expect(
        JSON.stringify([refusal?.publicMessage, refusal?.publicData])
      ).not.toContain(grace);
    });
  }
);
