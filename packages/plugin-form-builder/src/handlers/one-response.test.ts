/**
 * The key one response per person compares a submission by: its email
 * answer ignoring case, or its network address, and none for spam, for a
 * form that allows several responses, or where the value is missing.
 */
import { describe, expect, it } from "vitest";

import { responseKeyOf } from "./one-response";

/** A digest that shows what it was asked, so a test can read it back. */
const digests = () => ({
  digest: async (purpose: string, value: string) => `${purpose}:${value}`,
  prepare: async () => undefined,
});

const email = { oneResponse: "email" as const, oneResponseField: "email" };
const ip = { oneResponse: "ip" as const };

describe("a submission's one-response key", () => {
  it("compares an email answer ignoring case and surrounding spaces", async () => {
    expect(
      await responseKeyOf(digests, email, {
        data: { email: "  Ada@Example.COM " },
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
