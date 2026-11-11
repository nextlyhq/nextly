/**
 * Bot checks verified on the server, on every dialect, through the public
 * submit route: each provider's answer stubbed to pass and to fail, a missing
 * token, the reCAPTCHA setting of a form saved before the change with the
 * site default on and off, a check with no secret, and the site key a
 * visitor's form renders.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formBuilder } from "../plugin";

/** The provider's answer, as each test sets it. */
const answer = vi.hoisted(() => ({
  value: { success: true, score: 0.9 } as unknown,
}));

vi.mock("../handlers/bot-check-send", async original => ({
  ...(await original<typeof import("../handlers/bot-check-send")>()),
  sendVerification: vi.fn(async () => answer.value),
}));

const params = (...segments: string[]) => ({
  params: Promise.resolve({ params: segments }),
});

const KEYS = { siteKey: "site-key", secretKey: "secret-key" };

describe.each(getConfiguredTestDialects())("bot checks (%s)", dialect => {
  let current: TestNextly | undefined;
  beforeEach(() => {
    answer.value = { success: true, score: 0.9 };
  });
  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  async function boot(
    spamProtection: Record<string, unknown>,
    settings: Record<string, unknown>
  ) {
    const fb = formBuilder({
      spamProtection: { honeypot: false, ...spamProtection },
    });
    current = await createTestNextly({
      dialect,
      plugins: [fb.plugin],
      seedPublic: true,
    });
    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [
          { type: "text", name: "message", label: "Message" },
          { type: "email", name: "email", label: "Email" },
        ],
        settings: { honeypotEnabled: false, ...settings },
      },
    });
    const handlers = createDynamicHandlers();
    const rows = async () =>
      (
        await current!.nextly.find({
          collection: "form-submissions",
          limit: 100,
        })
      ).items as { id: string; status: string; spamReason: string | null }[];
    /** Post through the public route. */
    const post = (data: Record<string, unknown>) =>
      handlers.POST(
        new Request("http://localhost/api/forms/contact/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: { message: "hello", ...data } }),
        }),
        params("forms", "contact", "submit")
      );
    /** Submit through the public route, answering the row it stored. */
    const submit = async (data: Record<string, unknown>) => {
      const before = new Set((await rows()).map(row => row.id));
      expect((await post(data)).status).toBe(201);
      return (await rows()).find(row => !before.has(row.id));
    };
    const read = async () =>
      (await (
        await handlers.GET(
          new Request("http://localhost/api/forms/contact"),
          params("forms", "contact")
        )
      ).json()) as Record<string, unknown>;
    return { submit, read, post, rows };
  }

  it("accepts a submission whose reCAPTCHA token passes, and flags one that fails", async () => {
    const { submit } = await boot(
      { recaptcha: { enabled: false, ...KEYS } },
      { botCheck: "recaptcha" }
    );
    expect(await submit({ "g-recaptcha-response": "good" })).toMatchObject({
      status: "new",
    });

    answer.value = { success: true, score: 0.1 };
    expect(await submit({ "g-recaptcha-response": "low" })).toMatchObject({
      status: "spam",
      spamReason: "recaptcha",
    });
  });

  it("accepts a submission whose Turnstile token passes, and flags one that fails", async () => {
    const { submit } = await boot(
      { turnstile: { enabled: false, ...KEYS } },
      { botCheck: "turnstile" }
    );
    answer.value = { success: true };
    expect(await submit({ "cf-turnstile-response": "good" })).toMatchObject({
      status: "new",
    });

    answer.value = { success: false };
    expect(await submit({ "cf-turnstile-response": "bad" })).toMatchObject({
      status: "spam",
      spamReason: "turnstile",
    });
  });

  it("flags a submission that brings no token", async () => {
    const { submit } = await boot(
      { turnstile: { enabled: false, ...KEYS } },
      { botCheck: "turnstile" }
    );
    expect(await submit({})).toMatchObject({
      status: "spam",
      spamReason: "turnstile",
    });
  });

  // Saved before bot checks were verified: unset follows the site default,
  // on is reCAPTCHA, off is off. Every case submits a failing token, so a
  // check that runs flags it and one that does not leaves it new.
  it.each([
    [{}, true, "spam"],
    [{}, false, "new"],
    [{ captchaEnabled: true }, true, "spam"],
    [{ captchaEnabled: true }, false, "spam"],
    [{ captchaEnabled: false }, true, "new"],
    [{ captchaEnabled: false }, false, "new"],
  ])(
    "keeps a form saved with %j protected as before, with the site default on: %s",
    async (stored, siteDefault, status) => {
      const { submit } = await boot(
        { recaptcha: { enabled: siteDefault, ...KEYS } },
        stored
      );
      answer.value = { success: false };
      expect(await submit({ "g-recaptcha-response": "bad" })).toMatchObject({
        status,
      });
    }
  );

  it("judges an invalid submission's token before refusing it", async () => {
    const { submit, post, rows } = await boot(
      { turnstile: { enabled: false, ...KEYS } },
      { botCheck: "turnstile" }
    );
    // A failing token: kept as spam evidence, answered as a success.
    answer.value = { success: false };
    expect(
      await submit({ email: "not-an-email", "cf-turnstile-response": "bad" })
    ).toMatchObject({ status: "spam", spamReason: "turnstile" });

    // A passing token: the visitor is told what to fix, and nothing is kept.
    answer.value = { success: true };
    const before = (await rows()).length;
    const res = await post({
      email: "not-an-email",
      "cf-turnstile-response": "good",
    });
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(before);
  });

  it("accepts submissions unchecked when the check has a secret but no site key", async () => {
    const { submit, read } = await boot(
      { turnstile: { enabled: false, secretKey: "secret-key" } },
      { botCheck: "turnstile" }
    );
    answer.value = { success: false };
    expect(await submit({})).toMatchObject({ status: "new" });
    expect(await read()).not.toHaveProperty("botCheck");
  });

  it("accepts submissions unchecked when the form's check has no secret", async () => {
    const { submit, read } = await boot(
      { recaptcha: { enabled: true, siteKey: "site-key" } },
      { botCheck: "recaptcha" }
    );
    answer.value = { success: false };
    expect(await submit({})).toMatchObject({ status: "new" });
    // Not verified, so not rendered either.
    expect(await read()).not.toHaveProperty("botCheck");
  });

  it("gives a visitor's form the site key, a form's own legacy key included", async () => {
    const { read } = await boot(
      { recaptcha: { enabled: false, secretKey: "secret-key" } },
      { captchaEnabled: true, captchaSiteKey: "legacy-site-key" }
    );
    expect((await read()).botCheck).toEqual({
      provider: "recaptcha",
      siteKey: "legacy-site-key",
      field: "g-recaptcha-response",
    });
  });
});
