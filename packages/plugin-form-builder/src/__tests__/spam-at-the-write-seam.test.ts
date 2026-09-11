/**
 * Spam is judged at the seam every door passes through, not in one route.
 *
 * The submissions collection grants public create on purpose, so a visitor can
 * submit without an account. That makes the generic collection create a second
 * public door and the Direct API a third, and a rule that lives in the form
 * route guards the form route. These drive the write-seam hook directly, which
 * is what the other two doors reach and what `submitForm` also passes through.
 *
 * @module __tests__/spam-at-the-write-seam
 */
import { NextlyError } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { asPluginSubmission } from "../handlers/prepare-submission";
import { prepareSubmissionForWrite } from "../plugin";

const FIELDS = [{ name: "email", label: "Email", type: "text" }];

function nextlyWith(spamProtection: Record<string, unknown>): never {
  return {
    __formBuilderConfig: { spamProtection },
  } as never;
}

/**
 * A create as the other two doors make it: a row, and a request behind it.
 *
 * `form` is per-case rather than shared. The rate-limit window is keyed by form
 * and address, and the store outlives one test, so a shared id would let one
 * case spend another's budget and the failure would look like the limiter
 * working.
 *
 * `ip` is read by presence, not by `??`: the case that matters most passes
 * `null`, which is what the core answers when no address can be trusted, and
 * `??` would quietly turn it back into an address.
 */
function writeOf(
  payload: Record<string, unknown>,
  opts: {
    form?: string;
    ip?: string | null;
    request?: boolean;
    fields?: unknown[];
  } = {}
) {
  const form = opts.form ?? "f1";
  const ip = "ip" in opts ? opts.ip : "203.0.113.7";
  const row = asPluginSubmission(
    { form, data: payload },
    { form: { id: form, fields: (opts.fields ?? FIELDS) as never } }
  );
  return {
    data: row,
    operation: "create",
    ...(opts.request === false
      ? {}
      : { req: { http: { ip, method: "POST" } } }),
  };
}

const run = (ctx: unknown, spam: Record<string, unknown>) =>
  prepareSubmissionForWrite(ctx, "forms", nextlyWith(spam));

afterEach(() => {
  delete process.env.TRUSTED_PROXY_IPS;
});

describe("the write seam judges a submission", () => {
  it("flags a honeypot hit rather than dropping it", async () => {
    const ctx = writeOf({ email: "a@b.test", website: "http://spam.example" });
    await run(ctx, { honeypot: true });
    // Stored, flagged: a false positive stays reviewable and recoverable.
    expect(ctx.data.status).toBe("spam");
    expect(ctx.data.spamReason).toBe("honeypot");
  });

  it("leaves a clean submission alone", async () => {
    // The control. A seam that flagged everything would satisfy the case above
    // while making the Spam view the only view.
    const ctx = writeOf({ email: "a@b.test" });
    await run(ctx, { honeypot: true });
    expect(ctx.data.status).toBeUndefined();
  });

  it("does not trip on a field the form actually declares", async () => {
    // `website` is both a stock honeypot name and an ordinary form field. The
    // trap is set among the keys the form does NOT declare, so a form that
    // asks for a website is not a form whose every submission is bot traffic.
    const ctx = writeOf(
      { email: "a@b.test", website: "http://mysite.example" },
      { fields: [...FIELDS, { name: "website", label: "Site", type: "text" }] }
    );
    await run(ctx, { honeypot: true });
    expect(ctx.data.status).toBeUndefined();
  });

  it("says nothing about a write no request produced", async () => {
    // A seed, an import, a job. The whole reason the core carries the request:
    // a rule aimed at a visitor must not judge a server importing rows as one.
    const ctx = writeOf(
      { email: "a@b.test", website: "http://spam.example" },
      { request: false }
    );
    await run(ctx, { honeypot: true });
    expect(ctx.data.status).toBeUndefined();
  });

  it("refuses a submission over the limit, and refuses it as a rate limit", async () => {
    const spam = {
      honeypot: false,
      rateLimit: { maxSubmissions: 1, windowMs: 60_000 },
    };
    await run(writeOf({ email: "a@b.test" }, { form: "limited" }), spam);
    // The second one is over.
    await expect(
      run(writeOf({ email: "c@d.test" }, { form: "limited" }), spam)
    ).rejects.toSatisfy((error: unknown) => NextlyError.isRateLimited(error));
  });

  it("counts an unidentifiable client as nobody rather than as everybody", async () => {
    // `ip: null` is what the resolver answers when no address can be trusted.
    // Keying a window on that would put every such visitor in one bucket, where
    // the first bot to fill it locks out the rest.
    const spam = {
      honeypot: false,
      rateLimit: { maxSubmissions: 1, windowMs: 60_000 },
    };
    await run(writeOf({ email: "a@b.test" }, { form: "anon", ip: null }), spam);
    await expect(
      run(writeOf({ email: "c@d.test" }, { form: "anon", ip: null }), spam)
    ).resolves.toBeDefined();
  });
});
