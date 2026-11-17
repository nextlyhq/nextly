/**
 * The forms plugin's provider, with the plugin's reads stood in for: what it
 * lists, how it describes a form for the public and for an author, and how
 * a native post's answers reach the same `submitForm` the JSON address calls.
 *
 * Against a real database, through the page builder's receiver:
 * `__tests__/form-provider.integration.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const submitForm = vi.hoisted(() => vi.fn());
vi.mock("../handlers/submit-form", () => ({ submitForm }));

import { formBuilder } from "../plugin";

import { BOT_CHECK_SCRIPT_PATH } from "./bot-check-script";
import { FORMS_PROVIDER_ID, formsProvider } from "./provider";

afterEach(() => {
  submitForm.mockReset();
});

const CONTACT = {
  id: "f1",
  name: "Contact",
  slug: "contact",
  status: "published",
  fields: [
    { type: "email", name: "email", label: "Email", required: true },
    { type: "checkbox", name: "updates", label: "Send me updates" },
    {
      type: "select",
      name: "topics",
      label: "Topics",
      allowMultiple: true,
      options: [
        { value: "sales", label: "Sales" },
        { value: "help", label: "Help" },
      ],
    },
  ],
  settings: {
    submitButtonText: "Ask us",
    confirmationType: "message",
    successMessage: "<p>Thanks &amp; <b>welcome</b>!</p>",
  },
};

/** A provider over forms `rows`, recording each read and who it was read as. */
function provider(
  rows: Record<string, unknown>[],
  options: Parameters<typeof formBuilder>[0] = {}
) {
  const reads: { where?: unknown; access: unknown }[] = [];
  const context = {
    self: {
      name: "@nextlyhq/plugin-form-builder",
      collections: {},
      singles: {},
    },
    services: {
      collections: {
        listEntries: vi.fn(
          async (
            _collection: string,
            query: { where?: { id?: { equals?: string } } },
            access: unknown
          ) => {
            reads.push({ where: query.where, access });
            const id = query.where?.id?.equals;
            return {
              data: rows.filter(row => id === undefined || row.id === id),
              pagination: { total: rows.length, limit: 200, offset: 0 },
            };
          }
        ),
      },
      ownCollections: { count: vi.fn(async () => 0) },
    },
  };
  const { config } = formBuilder(options);
  return {
    forms: formsProvider({ config, context: () => context as never }),
    reads,
  };
}

const PUBLIC = { access: { as: "public" as const } };

describe("the forms plugin as a provider", () => {
  it("is offered as Forms", () => {
    const { forms } = provider([]);
    expect(forms.id).toBe(FORMS_PROVIDER_ID);
    expect(forms.label).toBe("Forms");
  });

  it("lists its forms with their state and where each is edited, read as the author", async () => {
    const author = { as: "user" as const, user: { id: "u1" } as never };
    const { forms, reads } = provider([
      CONTACT,
      { id: "f2", name: "Draft", slug: "draft", status: "draft" },
      { id: "f3", name: "Old", slug: "old", status: "closed" },
    ]);
    expect(await forms.list(author)).toEqual([
      {
        ref: "f1",
        title: "Contact",
        state: "published",
        editHref: "/admin/collections/forms/f1",
      },
      {
        ref: "f2",
        title: "Draft",
        state: "draft",
        editHref: "/admin/collections/forms/f2",
      },
      {
        ref: "f3",
        title: "Old",
        state: "closed",
        editHref: "/admin/collections/forms/f3",
      },
    ]);
    expect(reads[0]?.access).toBe(author);
  });

  it("describes a form for the public, its button and own message as plain words", async () => {
    const { forms, reads } = provider([CONTACT]);
    const described = await forms.describe("f1", PUBLIC);
    expect(described).toEqual({
      ref: "f1",
      title: "Contact",
      fields: [
        { name: "email", label: "Email", kind: "email", required: true },
        { name: "updates", label: "Send me updates", kind: "checkbox" },
        {
          name: "topics",
          label: "Topics",
          kind: "checkbox",
          options: [
            { value: "sales", label: "Sales" },
            { value: "help", label: "Help" },
          ],
        },
      ],
      submitText: "Ask us",
      afterSending: { kind: "message", message: "Thanks & welcome !" },
      encoding: "urlencoded",
    });
    expect(reads[0]).toEqual({
      where: { id: { equals: "f1" } },
      access: PUBLIC.access,
    });
  });

  it("follows the form's own redirect", async () => {
    const { forms } = provider([
      {
        ...CONTACT,
        settings: { confirmationType: "redirect", redirectUrl: "/thanks" },
      },
    ]);
    expect(
      (await forms.describe("f1", PUBLIC)) as { afterSending?: unknown }
    ).toMatchObject({ afterSending: { kind: "page", href: "/thanks" } });
  });

  it("answers a closed form with its own message, and a draft or gone one as missing", async () => {
    const { forms } = provider([
      {
        ...CONTACT,
        status: "closed",
        wentLiveAt: "2026-11-01T00:00:00.000Z",
        closedMessage: "<p>Closed for now.</p>",
      },
      { id: "f2", name: "Draft", slug: "draft", status: "draft" },
    ]);
    expect(await forms.describe("f1", PUBLIC)).toEqual({
      unavailable: "closed",
      message: "Closed for now.",
    });
    expect(await forms.describe("f2", PUBLIC)).toEqual({
      unavailable: "missing",
    });
    expect(await forms.describe("nope", PUBLIC)).toEqual({
      unavailable: "missing",
    });
  });

  it("describes a draft to its author, for the canvas", async () => {
    const { forms } = provider([
      { id: "f2", name: "Draft", slug: "draft", status: "draft" },
    ]);
    const described = await forms.describe("f2", {
      access: { as: "user", user: { id: "u1" } as never },
    });
    expect(described).toMatchObject({ ref: "f2", title: "Draft" });
  });

  it("declares its bot check as the script the form needs, with the answer it fills", async () => {
    const { forms } = provider(
      [{ ...CONTACT, settings: { botCheck: "turnstile" } }],
      {
        spamProtection: {
          turnstile: { enabled: true, siteKey: "site-1", secretKey: "secret" },
        },
      }
    );
    const described = (await forms.describe("f1", PUBLIC)) as {
      script?: unknown;
      fields: { name: string; kind: string; provider?: unknown }[];
    };
    expect(described.script).toEqual({
      module: `/admin/api/plugins/@nextlyhq/plugin-form-builder${BOT_CHECK_SCRIPT_PATH}`,
      reason: "Draws the form's bot check.",
    });
    expect(described.fields.at(-1)).toEqual({
      name: "cf-turnstile-response",
      label: "Bot check",
      kind: "hidden",
      provider: { "forms-bot-check": "turnstile", "forms-site-key": "site-1" },
    });
    // The secret never reaches the description.
    expect(JSON.stringify(described)).not.toContain("secret");
  });

  it("needs no script for a form without a bot check", async () => {
    const { forms } = provider([CONTACT]);
    expect(await forms.describe("f1", PUBLIC)).not.toHaveProperty("script");
  });
});

describe("a native post, accepted", () => {
  const post = (answers: [string, string[]][]) => ({
    answers: new Map(answers),
    request: new Request(
      "https://site.example/admin/api/plugins/x/forms/send",
      {
        method: "POST",
        headers: {
          "user-agent": "Browser/1",
          referer: "https://site.example/contact",
        },
      }
    ),
  });

  it("is handed to submitForm as the JSON address hands it, as the public", async () => {
    submitForm.mockResolvedValue({ success: true, outcome: "accepted" });
    const { forms } = provider([CONTACT]);
    const sent = post([
      ["email", ["ada@example.com"]],
      ["updates", ["yes"]],
      ["topics", ["sales", "help"]],
    ]);
    expect(await forms.accept("f1", sent)).toEqual({ kind: "sent" });
    const [options, context] = submitForm.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      formSlug: "contact",
      data: {
        email: "ada@example.com",
        // A ticked box as the plugin reads one, and every chosen topic.
        updates: "on",
        topics: ["sales", "help"],
      },
      request: sent.request,
      access: { as: "public" },
      metadata: {
        userAgent: "Browser/1",
        page: "https://site.example/contact",
      },
    });
    expect(context.pluginConfig.formOverrides.slug).toBe("forms");
  });

  it("answers each of submitForm's outcomes as the receiver shows it", async () => {
    const { forms } = provider([CONTACT]);
    const cases: [Record<string, unknown>, unknown][] = [
      [
        { outcome: "accepted", redirect: "/thanks" },
        {
          kind: "sent",
          afterSending: { kind: "page", href: "/thanks" },
        },
      ],
      [
        { outcome: "invalid", validationErrors: { email: "Enter an email." } },
        {
          kind: "invalid",
          issues: [{ field: "email", message: "Enter an email." }],
        },
      ],
      [{ outcome: "closed" }, { kind: "closed" }],
      [{ outcome: "duplicate" }, { kind: "closed" }],
      [{ outcome: "no-such-form" }, { kind: "failed" }],
      [{ outcome: "failed" }, { kind: "failed" }],
    ];
    for (const [result, expected] of cases) {
      submitForm.mockResolvedValueOnce(result);
      expect(
        await forms.accept("f1", post([["email", ["a@b.co"]]])),
        JSON.stringify(result)
      ).toEqual(expected);
    }
  });

  it("asks nothing of submitForm for a closed or gone form", async () => {
    const { forms } = provider([
      { ...CONTACT, status: "closed", wentLiveAt: "2026-11-01T00:00:00.000Z" },
    ]);
    expect(await forms.accept("f1", post([]))).toEqual({ kind: "closed" });
    expect(await forms.accept("gone", post([]))).toEqual({ kind: "failed" });
    expect(submitForm).not.toHaveBeenCalled();
  });
});
