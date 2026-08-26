/**
 * R4/D56 — full submission flow end-to-end through the harness: `submitForm`
 * resolves the form via the D56 `where` query, validates, and persists a
 * submission via the secure managed service. Proves a plugin that OWNS its
 * collections (forms/form-submissions) is fully testable with `createTestNextly`
 * (the case P7b mistakenly believed was blocked — it was a stale-dist artifact).
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * Capture the live PluginContext via a probe plugin — the same object the
 * form-builder's own hooks receive, so `submitForm` runs against the real
 * service surface.
 */
function contextProbe(name: string): {
  plugin: ReturnType<typeof definePlugin>;
  get: () => PluginContext;
} {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: context => {
      captured = context;
    },
  });
  return {
    plugin,
    get: () => {
      if (!captured) throw new Error("probe plugin did not initialize");
      return captured;
    },
  };
}

describe("submitForm end-to-end", () => {
  it("resolves the form, validates, and persists a submission", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-submit");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
      },
    });

    const result = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );

    expect(result.success).toBe(true);
    expect(
      await probe
        .get()
        .services.collections.count("form-submissions", {}, { as: "system" })
    ).toBe(1);

    // `submission` is the stored DOCUMENT, which the declared result type says
    // and TypeScript cannot check: the conversion from the service's loose row
    // shape goes through `unknown`. Asserting only `success` and the row count
    // is what let the result carry a mutation envelope here instead of the
    // document, handing every caller `undefined` for `submission.id`.
    expect(result.submission?.id).toEqual(expect.any(String));
    // The status the schema stores. `spam` belongs to this union too — the
    // stored field offers it and the admin has a tab for it — so a document
    // type that omitted it was describing a shape the database cannot produce.
    expect(["new", "read", "archived", "spam"]).toContain(
      result.submission?.status
    );
    expect(result.submission?.data).toMatchObject({ message: "hello" });
    expect(result.submission).not.toHaveProperty("item");
  });

  it("stores honeypot hits flagged as spam instead of dropping them", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: true, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-spam");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
      },
    });

    const result = await submitForm(
      {
        formSlug: "contact",
        // A filled honeypot field marks the submission as bot traffic.
        data: { message: "buy things", _hp: "gotcha" },
      },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );

    // The bot still sees success and gets no stored-row reference.
    expect(result.success).toBe(true);
    expect(result.submission).toBeUndefined();

    // The submission is stored, flagged, and carries the detection reason.
    const stored = await current.nextly.find({
      collection: "form-submissions",
      where: { status: { equals: "spam" } },
    });
    expect(stored.items).toHaveLength(1);
    expect((stored.items[0] as { spamReason?: string }).spamReason).toBe(
      "honeypot"
    );

    // Flagged rows never count toward the form's submissionCount.
    const form = await current.nextly.find({
      collection: "forms",
      where: { slug: { equals: "contact" } },
    });
    expect(
      (form.items[0] as { submissionCount?: number }).submissionCount
    ).toBe(0);
  });

  it("rejects a second submission from the same IP on single-submission forms", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-single");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "RSVP",
        slug: "rsvp",
        status: "published",
        fields: [{ type: "text", name: "name", label: "Name" }],
        settings: { allowMultipleSubmissions: false },
      },
    });

    const submit = () =>
      submitForm(
        {
          formSlug: "rsvp",
          data: { name: "Ada" },
          metadata: { ipAddress: "203.0.113.9" },
        },
        { pluginContext: probe.get(), pluginConfig: fb.config }
      );

    expect((await submit()).success).toBe(true);
    const second = await submit();
    expect(second.success).toBe(false);
    expect(second.error).toContain("already submitted");
  });

  it("lets a per-form honeypot override disable the plugin-level trap", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: true, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-hp-override");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Open",
        slug: "open",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
        // The form opts out of the honeypot even though the plugin has it on.
        settings: { honeypotEnabled: false },
      },
    });

    const result = await submitForm(
      { formSlug: "open", data: { message: "hi", _hp: "filled" } },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );

    expect(result.success).toBe(true);
    const stored = await current.nextly.find({
      collection: "form-submissions",
      where: { status: { equals: "new" } },
    });
    expect(stored.items).toHaveLength(1);
  });

  it("gives a honeypot bot the same fake success even when validation would fail", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: true, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-spam-invalid");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [
          { type: "text", name: "message", label: "Message", required: true },
        ],
      },
    });

    // Honeypot filled AND the required field missing: a validation error
    // here would let bots distinguish trap hits from accepted submissions.
    const result = await submitForm(
      { formSlug: "contact", data: { _hp: "gotcha" } },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );

    expect(result.success).toBe(true);
    expect(result.validationErrors).toBeUndefined();

    const stored = await current.nextly.find({
      collection: "form-submissions",
      where: { status: { equals: "spam" } },
    });
    expect(stored.items).toHaveLength(1);
  });
});

describe("what a form that is not taking submissions says", () => {
  /** Boots a form in the given state and submits to it. */
  async function submitTo(status: string, extra: Record<string, unknown> = {}) {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-closed");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    // A CLOSED form is published first and then moved, because that is the
    // only status whose meaning depends on history: it is served to the public
    // on the strength of having once been live. A draft has no such history and
    // is created as one.
    const publishFirst = status === "closed";

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: publishFirst ? "published" : status,
        fields: [{ type: "text", name: "message", label: "Message" }],
        ...extra,
      },
    });

    if (publishFirst) {
      await current.nextly.update({
        collection: "forms",
        where: { slug: { equals: "contact" } },
        data: { status },
      });
    }

    return submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );
  }

  it("relays the message the author wrote for a CLOSED form", async () => {
    // The field existed, was stored, and was read by nothing: every
    // non-published form answered with one fixed sentence, so the box in the
    // admin changed nothing an author or a visitor could see.
    const result = await submitTo("closed", {
      closedMessage:
        "Applications closed on 31 March. Try again in the autumn.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Applications closed on 31 March. Try again in the autumn."
    );
  });

  it("falls back to the generic sentence when a closed form has no message", async () => {
    // Blank is not an instruction. An author who cleared the box gets the
    // default rather than an empty explanation.
    const result = await submitTo("closed", { closedMessage: "   " });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "This form is not currently accepting submissions"
    );
  });

  it("says nothing specific about a form created closed and never released", async () => {
    // `closed` does not by itself mean a form was ever public: the collection
    // accepts it on creation. Relaying an author's message here would confirm
    // an unreleased form exists to anyone who guessed its slug.
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-never-published");
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "closed",
        closedMessage: "Applications closed on 31 March.",
        fields: [{ type: "text", name: "message", label: "Message" }],
      },
    });

    const result = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      { pluginContext: probe.get(), pluginConfig: fb.config }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "This form is not currently accepting submissions"
    );
  });

  it("says nothing specific about a DRAFT", async () => {
    // A draft has never been public. There is no author intent to relay, and
    // nothing here should distinguish it from a form that does not exist.
    const result = await submitTo("draft", {
      closedMessage: "Applications closed on 31 March.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "This form is not currently accepting submissions"
    );
  });
});
