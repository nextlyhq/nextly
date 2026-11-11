/**
 * The key one response per person compares a submission by: its email
 * answer ignoring case, its network address, or its browser's token, and
 * none for spam, for a form that allows several responses, or where the
 * value is missing; and how a browser's key is judged and kept, since the
 * token it is made from is never stored.
 */
import { describe, expect, it } from "vitest";

import {
  BROWSER_TOKEN_FIELD,
  browserTokenOf,
  holdsKeyFor,
  publicOneResponse,
  responseKeyAfterUpdate,
  responseKeyOf,
} from "./one-response";

/** A digest that shows what it was asked, so a test can read it back. */
const digests = () => ({
  digest: async (purpose: string, value: string) => `${purpose}:${value}`,
  prepare: async () => undefined,
});

const email = { oneResponse: "email" as const, oneResponseField: "email" };
const ip = { oneResponse: "ip" as const };
const browser = { oneResponse: "browser" as const };
const TOKEN = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("a submission's one-response key", () => {
  it("compares an email answer ignoring case and surrounding spaces", async () => {
    expect(
      await responseKeyOf(digests, email, {
        data: { email: "  Ada@Example.COM " },
      })
    ).toBe("email:ada@example.com");
  });

  it("reads answers stored as a JSON string, as a stored row holds them", async () => {
    expect(
      await responseKeyOf(digests, email, {
        data: JSON.stringify({ email: "Ada@Example.com" }),
      })
    ).toBe("email:ada@example.com");
  });

  it("compares the network address", async () => {
    expect(await responseKeyOf(digests, ip, { ipAddress: "203.0.113.9" })).toBe(
      "ip:203.0.113.9"
    );
  });

  it("gives none to spam, which takes no place", async () => {
    expect(
      await responseKeyOf(digests, ip, {
        status: "spam",
        ipAddress: "203.0.113.9",
      })
    ).toBeNull();
  });

  it("gives none where the form allows several responses", async () => {
    expect(
      await responseKeyOf(
        digests,
        { oneResponse: "off" },
        { ipAddress: "203.0.113.9" }
      )
    ).toBeNull();
  });

  it("gives none where the value it compares is missing", async () => {
    expect(await responseKeyOf(digests, ip, { ipAddress: "" })).toBeNull();
    expect(await responseKeyOf(digests, email, { data: {} })).toBeNull();
    expect(
      await responseKeyOf(
        digests,
        { oneResponse: "email" },
        { data: { email: "a@b.c" } }
      )
    ).toBeNull();
  });
});

describe("one response per browser", () => {
  it("reads a well-formed token from the answers, and nothing else", () => {
    expect(browserTokenOf({ [BROWSER_TOKEN_FIELD]: ` ${TOKEN} ` })).toBe(TOKEN);
    expect(
      browserTokenOf(JSON.stringify({ [BROWSER_TOKEN_FIELD]: TOKEN }))
    ).toBe(TOKEN);
    for (const bad of ["short", "has spaces in it ok", "x".repeat(129), 42]) {
      expect(browserTokenOf({ [BROWSER_TOKEN_FIELD]: bad })).toBeUndefined();
    }
    expect(browserTokenOf({})).toBeUndefined();
    expect(browserTokenOf(undefined)).toBeUndefined();
  });

  it("keys the token the submission came with, marked as a browser's", async () => {
    expect(await responseKeyOf(digests, browser, { browserToken: TOKEN })).toBe(
      `browser:browser:${TOKEN}`
    );
    // Never from the address, and none without a token or for spam.
    expect(
      await responseKeyOf(digests, browser, { ipAddress: "203.0.113.9" })
    ).toBeNull();
    expect(
      await responseKeyOf(digests, browser, {
        status: "spam",
        browserToken: TOKEN,
      })
    ).toBeNull();
  });

  it("judges a new row's key by the mode it was made for", async () => {
    const browserKey = `browser:browser:${TOKEN}`;
    // Under one per browser: a browser's key, or none (no token sent).
    expect(
      await holdsKeyFor(digests, browser, { responseKey: browserKey })
    ).toBe(true);
    expect(await holdsKeyFor(digests, browser, { responseKey: null })).toBe(
      true
    );
    // A key made for another mode, which that mode no longer compares.
    expect(
      await holdsKeyFor(digests, browser, {
        ipAddress: "203.0.113.9",
        responseKey: "ip:203.0.113.9",
      })
    ).toBe(false);
    // A browser's key once the form compares networks, or nothing.
    expect(
      await holdsKeyFor(digests, ip, {
        ipAddress: "203.0.113.9",
        responseKey: browserKey,
      })
    ).toBe(false);
    expect(
      await holdsKeyFor(
        digests,
        { oneResponse: "off" },
        {
          responseKey: browserKey,
        }
      )
    ).toBe(false);
    // Spam holds none, under every mode.
    expect(
      await holdsKeyFor(digests, browser, {
        status: "spam",
        responseKey: browserKey,
      })
    ).toBe(false);
  });

  it("keeps a browser's key through an edit, and gives it back once spam", async () => {
    const stored = {
      status: "new",
      data: { email: "a@b.co" },
      responseKey: `browser:browser:${TOKEN}`,
    };
    const after = (patch: Record<string, unknown>, from = stored) =>
      responseKeyAfterUpdate({
        digests,
        settings: browser,
        patch,
        stored: from,
        heldElsewhere: async () => false,
        moved: false,
      });
    expect(await after({ status: "read" })).toBe(stored.responseKey);
    expect(await after({ data: { email: "c@d.co" } })).toBe(stored.responseKey);
    expect(await after({ status: "spam" })).toBeNull();
    // Restored from spam: the token is gone, so it holds none.
    expect(
      await after(
        { status: "new" },
        { ...stored, status: "spam", responseKey: null }
      )
    ).toBeNull();
    // A key from another mode is not a browser's to keep.
    expect(
      await after({ status: "read" }, { ...stored, responseKey: "ip:1.2.3.4" })
    ).toBeNull();
  });

  it("tells a visitor's form where to send the token, only for a browser", () => {
    expect(publicOneResponse(browser)).toEqual({
      by: "browser",
      field: BROWSER_TOKEN_FIELD,
    });
    expect(publicOneResponse(ip)).toBeUndefined();
    expect(publicOneResponse({ oneResponse: "off" })).toBeUndefined();
  });
});
