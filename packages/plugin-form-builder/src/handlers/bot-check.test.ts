/**
 * Bot checks: which provider a form uses, what a provider's answer means,
 * the request it is asked with, the options it is configured from, and what
 * a visitor's form and the log is told when a check has no keys.
 */
import { describe, expect, it, vi } from "vitest";

import type { ResolvedFormBuilderConfig } from "../types";

import {
  botCheckHosts,
  judgeBotCheck,
  botCheckOptions,
  botProviderOf,
  botTokensOf,
  judgeBotToken,
  publicBotCheck,
  warnUncheckedFormCheck,
  warnUncheckedSiteDefault,
} from "./bot-check";
import { sendVerification, type VerifyFetch } from "./bot-check-send";

type Spam = ResolvedFormBuilderConfig["spamProtection"];

const keys = { secretKey: "secret", siteKey: "site" };
const spam = (overrides: Partial<Spam> = {}): Spam => ({
  honeypot: true,
  recaptcha: { enabled: false },
  turnstile: { enabled: false },
  ...overrides,
});

/** A provider answering `body`, recording what it was asked. */
function provider(body: unknown, ok = true) {
  const calls: { url: string; body: string }[] = [];
  const fetch: VerifyFetch = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
  return { fetch, calls };
}

describe("the provider a form uses", () => {
  it("follows the form's choice, and the site default otherwise", () => {
    const both = spam({
      recaptcha: { enabled: true, ...keys },
      turnstile: { enabled: true, ...keys },
    });
    expect(botProviderOf("turnstile", both)).toBe("turnstile");
    expect(botProviderOf("off", both)).toBeUndefined();
    // reCAPTCHA is the site default when both are enabled.
    expect(botProviderOf("default", both)).toBe("recaptcha");
    expect(
      botProviderOf("default", spam({ turnstile: { enabled: true } }))
    ).toBe("turnstile");
    expect(botProviderOf("default", spam())).toBeUndefined();
  });
});

describe("what a provider's answer means", () => {
  const judge = (
    p: "recaptcha" | "turnstile",
    fetch: VerifyFetch | undefined,
    token: string | undefined = "token",
    scoreThreshold?: number
  ) =>
    judgeBotToken({ provider: p, secret: "s", token, fetch, scoreThreshold });

  it("fails a submission that brought no token: the widget never ran", async () => {
    expect(
      await judgeBotToken({
        provider: "turnstile",
        secret: "s",
        token: undefined,
        fetch: provider({ success: true }).fetch,
      })
    ).toBe("fail");
  });

  it("passes and fails Turnstile by its answer", async () => {
    expect(await judge("turnstile", provider({ success: true }).fetch)).toBe(
      "pass"
    );
    expect(await judge("turnstile", provider({ success: false }).fetch)).toBe(
      "fail"
    );
  });

  it("passes reCAPTCHA only at or above the score threshold", async () => {
    const at = (score: number) => provider({ success: true, score }).fetch;
    expect(await judge("recaptcha", at(0.5))).toBe("pass");
    expect(await judge("recaptcha", at(0.4))).toBe("fail");
    expect(await judge("recaptcha", at(0.8), "token", 0.9)).toBe("fail");
    expect(
      await judge("recaptcha", provider({ success: false, score: 0.9 }).fetch)
    ).toBe("fail");
  });

  it("leaves a submission unchecked when the provider cannot be asked or answers nonsense", async () => {
    expect(await judge("recaptcha", undefined)).toBe("unchecked");
    expect(await judge("recaptcha", provider({}, false).fetch)).toBe(
      "unchecked"
    );
    expect(await judge("turnstile", provider({ nope: 1 }).fetch)).toBe(
      "unchecked"
    );
    const failing: VerifyFetch = async () => {
      throw new Error("offline");
    };
    expect(await judge("turnstile", failing)).toBe("unchecked");
  });
});

describe("the request a bot check makes", () => {
  it("posts the secret, the token and the address to the provider", async () => {
    const { fetch, calls } = provider({ success: true });
    await sendVerification(fetch, "turnstile", {
      secret: "s3cret",
      token: "t0ken",
      ip: "203.0.113.9",
    });
    expect(calls[0]?.url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      secret: "s3cret",
      response: "t0ken",
      remoteip: "203.0.113.9",
    });
    await sendVerification(fetch, "recaptcha", { secret: "s", token: "t" });
    expect(calls[1]?.url).toBe(
      "https://www.google.com/recaptcha/api/siteverify"
    );
  });
});

describe("the options", () => {
  it("default both providers off", () => {
    expect(botCheckOptions({})).toEqual({
      recaptcha: { enabled: false },
      turnstile: { enabled: false },
    });
  });

  it("refuse a threshold outside 0 to 1, naming the option", () => {
    expect(() =>
      botCheckOptions({ recaptcha: { enabled: true, scoreThreshold: 2 } })
    ).toThrow(/spamProtection\.recaptcha\.scoreThreshold/);
  });

  it("declare a provider's host only when its secret is set", () => {
    expect(botCheckHosts(spam())).toEqual([]);
    expect(
      botCheckHosts(
        spam({
          recaptcha: { enabled: true, siteKey: "site" },
          turnstile: { enabled: false, ...keys },
        })
      )
    ).toEqual(["challenges.cloudflare.com"]);
  });
});

describe("what a visitor's form is told", () => {
  it("gives the provider, the site key and the token's field name", () => {
    expect(
      publicBotCheck(
        { botCheck: "turnstile" },
        spam({ turnstile: { enabled: false, ...keys } })
      )
    ).toEqual({
      provider: "turnstile",
      siteKey: "site",
      field: "cf-turnstile-response",
    });
  });

  it("keeps using a site key a form stored before keys moved to the options", () => {
    expect(
      publicBotCheck(
        { captchaEnabled: true, captchaSiteKey: "legacy" },
        spam({ recaptcha: { enabled: false, secretKey: "secret" } })
      )
    ).toMatchObject({ provider: "recaptcha", siteKey: "legacy" });
  });

  it("gives nothing for a check that is off or has no secret", () => {
    expect(publicBotCheck({ botCheck: "off" }, spam())).toBeUndefined();
    expect(
      publicBotCheck(
        { botCheck: "recaptcha" },
        spam({ recaptcha: { enabled: true, siteKey: "s" } })
      )
    ).toBeUndefined();
  });

  it("reads each provider's token by its own field name", () => {
    expect(
      botTokensOf({
        "g-recaptcha-response": " r ",
        "cf-turnstile-response": "",
        name: "x",
      })
    ).toEqual({ recaptcha: "r" });
  });
});

describe("the warning that a check has no keys", () => {
  it("is said at start for the site default, from the options alone", () => {
    const warn = vi.fn();
    warnUncheckedSiteDefault(spam({ recaptcha: { enabled: true } }), warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /spamProtection\.recaptcha\.secretKey/
    );
    expect(warn.mock.calls[0]?.[1]).toEqual({ provider: "recaptcha" });
  });

  it("is not said at start when the site default is off or ready", () => {
    const warn = vi.fn();
    warnUncheckedSiteDefault(spam(), warn);
    warnUncheckedSiteDefault(
      spam({ turnstile: { enabled: true, ...keys } }),
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("is said when a form is saved naming a check without its keys", () => {
    const warn = vi.fn();
    const site = spam({ turnstile: { enabled: false, ...keys } });
    warnUncheckedFormCheck({ botCheck: "recaptcha" }, site, "contact", warn);
    expect(warn.mock.calls).toEqual([
      [
        expect.stringMatching(/spamProtection\.recaptcha\.secretKey/),
        { provider: "recaptcha", form: "contact" },
      ],
    ]);
  });

  it("is not said for a saved form whose check is off, ready or the site's", () => {
    const warn = vi.fn();
    // The site default here has no keys: said at start, not at every save.
    const site = spam({
      recaptcha: { enabled: true },
      turnstile: { enabled: false, ...keys },
    });
    warnUncheckedFormCheck({ botCheck: "off" }, site, "a", warn);
    warnUncheckedFormCheck({ botCheck: "turnstile" }, site, "b", warn);
    warnUncheckedFormCheck({ botCheck: "default" }, site, "c", warn);
    warnUncheckedFormCheck({}, site, "d", warn);
    // A form's own legacy reCAPTCHA site key makes its check ready.
    warnUncheckedFormCheck(
      { botCheck: "recaptcha", captchaSiteKey: "legacy" },
      spam({ recaptcha: { enabled: false, secretKey: "secret" } }),
      "e",
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("is said once when a submission is accepted unchecked, and again after a start", async () => {
    const warn = vi.fn();
    const site = spam({ turnstile: { enabled: false, siteKey: "site" } });
    const judge = (form: string) =>
      judgeBotCheck({
        settings: { botCheck: "turnstile" },
        spam: site,
        tokens: {},
        ip: undefined,
        fetch: provider({ success: false }).fetch,
        form,
        warn,
      });

    expect(await judge("contact")).toBeUndefined();
    expect(await judge("other")).toBeUndefined();
    expect(warn.mock.calls).toEqual([
      [
        expect.stringMatching(/spamProtection\.turnstile\.secretKey/),
        { provider: "turnstile", form: "contact" },
      ],
    ]);

    // A start (or a reload) says what it finds afresh.
    warnUncheckedSiteDefault(site, () => undefined);
    await judge("other");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("a check missing a key", () => {
  it("is not run without a site key a visitor's widget could use", async () => {
    const verdict = await judgeBotCheck({
      settings: { botCheck: "turnstile" },
      spam: spam({ turnstile: { enabled: false, secretKey: "secret" } }),
      tokens: {},
      ip: undefined,
      fetch: provider({ success: false }).fetch,
      warn: () => undefined,
    });
    // Unchecked rather than flagged: no visitor could have sent a token.
    expect(verdict).toBeUndefined();
  });

  it("is run with a form's own legacy reCAPTCHA site key", async () => {
    const verdict = await judgeBotCheck({
      settings: { botCheck: "recaptcha", captchaSiteKey: "legacy" },
      spam: spam({ recaptcha: { enabled: false, secretKey: "secret" } }),
      tokens: {},
      ip: undefined,
      fetch: provider({ success: true, score: 0.9 }).fetch,
      warn: () => undefined,
    });
    expect(verdict).toEqual({ isSpam: true, reason: "recaptcha" });
  });

  it("is named in the start-up warning", () => {
    const warn = vi.fn();
    warnUncheckedSiteDefault(
      spam({ turnstile: { enabled: true, secretKey: "secret" } }),
      warn
    );
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /spamProtection\.turnstile\.siteKey/
    );
  });
});
