/**
 * A consent field, on every dialect: a submission stores the choice with the
 * text the form showed, whatever text the visitor sent; an edit that would
 * change a submitted consent is refused through the admin (a signed-in staff
 * member's update, judged by the access gate) and through the Direct API;
 * and an edit of another answer keeps the consent, text and all, even after
 * the form's text has changed.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";
import { CONSENT_EDIT_REFUSED } from "../utils/consent";

const AGREEMENT = "I agree to the privacy policy";
const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  {
    type: "consent",
    name: "privacy",
    label: "Privacy",
    required: true,
    agreementText: AGREEMENT,
  },
];

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
  const fb = formBuilder({
    spamProtection: { honeypot: false, recaptcha: { enabled: false } },
  });
  let probe: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      fb.plugin,
      definePlugin({
        name: "@test/fb-consent-probe",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init: ctx => {
          probe = ctx;
        },
      }),
    ],
    seedPublic: true,
  });
  const t = current;
  const form = await t.nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      status: "published",
      fields: FIELDS,
    },
  });

  const submit = (data: Record<string, unknown>) =>
    submitForm(
      { formSlug: "contact", data },
      { pluginContext: probe!, pluginConfig: fb.config }
    );

  const answers = async (id: string) =>
    (
      (await t.nextly.findByID({ collection: "form-submissions", id })) as {
        data: Record<string, unknown>;
      }
    ).data;

  /** The staff member the admin's Edit answers acts as: may read and update. */
  const staff = async () => {
    const direct = t.nextly as unknown as Direct;
    // The install's first user holds super-admin, which passes every rule, so
    // it is made first and kept out of the cases.
    await direct.users.create({
      email: "owner@example.com",
      password: "Password123!",
      data: { name: "Owner", isActive: true },
    });
    const seeded = (await direct.permissions.find({ limit: 1000 })).items;
    const ids = ["read-form-submissions", "update-form-submissions"].map(
      slug => {
        const found = seeded.find(permission => permission.slug === slug);
        if (!found) throw new Error(`boot seeded no ${slug}`);
        return String(found.id);
      }
    );
    const role = await direct.roles.create({
      data: {
        name: "Edits submissions",
        slug: "edits-submissions",
        permissionIds: ids,
      },
    });
    const user = await direct.users.create({
      email: "staff@example.com",
      password: "Password123!",
      data: { name: "Staff", isActive: true, roles: [role.item.id] },
    });
    return { id: user.item.id };
  };

  return { t, formId: String(form.item.id), submit, answers, staff };
}

/** The one submission stored, by id. */
async function onlySubmission(t: TestNextly): Promise<string> {
  const { items } = await t.nextly.find({
    collection: "form-submissions",
    limit: 10,
  });
  expect(items).toHaveLength(1);
  return String((items[0] as { id: unknown }).id);
}

describe.each(getConfiguredTestDialects())("a consent field (%s)", dialect => {
  it("stores the choice with the form's text, not one the visitor sent", async () => {
    const { t, submit, answers } = await boot(dialect);
    const sent = await submit({
      name: "Ada",
      privacy: { agreed: true, text: "I agree to nothing" },
    });
    expect(sent.success).toBe(true);

    expect((await answers(await onlySubmission(t))).privacy).toEqual({
      agreed: true,
      text: AGREEMENT,
    });
  });

  it("refuses a submission whose consent was not given", async () => {
    const { t, submit } = await boot(dialect);
    expect((await submit({ name: "Ada" })).success).toBe(false);
    expect((await submit({ name: "Ada", privacy: "no" })).success).toBe(false);
    const { items } = await t.nextly.find({ collection: "form-submissions" });
    expect(items).toHaveLength(0);
  });

  it("refuses the admin's edit of a consent, and keeps it", async () => {
    const { t, submit, answers, staff } = await boot(dialect);
    await submit({ name: "Ada", privacy: "on" });
    const id = await onlySubmission(t);
    const before = await answers(id);
    const user = await staff();

    const edit = (data: Record<string, unknown>) =>
      t.nextly.update({
        collection: "form-submissions",
        id,
        data: { data, _overwrite: true },
        overrideAccess: false,
        user,
      });

    await expect(
      edit({ ...before, privacy: { agreed: false, text: AGREEMENT } })
    ).rejects.toMatchObject({
      publicData: {
        errors: [{ path: "privacy", message: CONSENT_EDIT_REFUSED }],
      },
    });
    expect(await answers(id)).toEqual(before);

    // The control: the same staff member's edit of another answer, carrying
    // the consent as it is, goes through.
    await edit({ ...before, name: "Ada Lovelace" });
    expect(await answers(id)).toEqual({ ...before, name: "Ada Lovelace" });
  });

  it("refuses an API edit that changes or drops a consent", async () => {
    const { t, submit, answers } = await boot(dialect);
    await submit({ name: "Ada", privacy: "on" });
    const id = await onlySubmission(t);
    const before = await answers(id);
    const edit = (data: Record<string, unknown>) =>
      t.nextly.update({
        collection: "form-submissions",
        id,
        data: { data, _overwrite: true },
      });
    const refusal = {
      publicData: {
        errors: [{ path: "privacy", message: CONSENT_EDIT_REFUSED }],
      },
    };

    await expect(
      edit({ ...before, privacy: { agreed: true, text: "Something else" } })
    ).rejects.toMatchObject(refusal);
    await expect(edit({ name: before.name })).rejects.toMatchObject(refusal);
    expect(await answers(id)).toEqual(before);
  });

  it("keeps a consent through edits once the form no longer has its field", async () => {
    const { t, formId, submit, answers } = await boot(dialect);
    await submit({ name: "Ada", privacy: "on" });
    const id = await onlySubmission(t);
    const before = await answers(id);

    await t.nextly.update({
      collection: "forms",
      id: formId,
      data: {
        fields: FIELDS.filter(field => field.type !== "consent"),
        _overwrite: true,
      },
    });
    const edit = (data: Record<string, unknown>) =>
      t.nextly.update({
        collection: "form-submissions",
        id,
        data: { data, _overwrite: true },
      });

    // As the admin sends it: every stored answer, one of them edited.
    await edit({ ...before, name: "Ada Lovelace" });
    expect(await answers(id)).toEqual({ ...before, name: "Ada Lovelace" });
    // Changing or dropping the consent is still refused.
    const refusal = {
      publicData: {
        errors: [{ path: "privacy", message: CONSENT_EDIT_REFUSED }],
      },
    };
    await expect(
      edit({ ...before, privacy: { agreed: false, text: AGREEMENT } })
    ).rejects.toMatchObject(refusal);
    await expect(edit({ name: "Ada" })).rejects.toMatchObject(refusal);
    expect((await answers(id)).privacy).toEqual(before.privacy);
  });

  it("refuses a form saved with a consent that has no text", async () => {
    const { t, formId } = await boot(dialect);
    const blank = FIELDS.map(field =>
      field.type === "consent" ? { ...field, agreementText: "  " } : field
    );
    const refusal = {
      publicData: {
        errors: [{ path: "fields.privacy.agreementText", code: "REQUIRED" }],
      },
    };
    await expect(
      t.nextly.update({
        collection: "forms",
        id: formId,
        data: { fields: blank, _overwrite: true },
      })
    ).rejects.toMatchObject(refusal);
    await expect(
      t.nextly.create({
        collection: "forms",
        data: { name: "Other", slug: "other", fields: blank },
      })
    ).rejects.toMatchObject(refusal);
  });

  it("keeps the text agreed to through an edit made after the form's text changed", async () => {
    const { t, formId, submit, answers } = await boot(dialect);
    await submit({ name: "Ada", privacy: "on" });
    const id = await onlySubmission(t);
    const before = await answers(id);

    await t.nextly.update({
      collection: "forms",
      id: formId,
      data: {
        fields: FIELDS.map(field =>
          field.type === "consent"
            ? { ...field, agreementText: "I agree to the new policy" }
            : field
        ),
        _overwrite: true,
      },
    });
    await t.nextly.update({
      collection: "form-submissions",
      id,
      data: { data: { ...before, name: "Ada Lovelace" }, _overwrite: true },
    });

    expect((await answers(id)).privacy).toEqual({
      agreed: true,
      text: AGREEMENT,
    });
  });
});
