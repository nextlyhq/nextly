/**
 * How Resend's answer about a sending domain is read: its state as the three a
 * person acts on, and the DNS records it expects, an MX record's priority
 * included. Resend is not called; its two answers are stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resendDomainStatus } from "../services/providers/resend-provider";

function stubResend(status: string, records: unknown[] = []) {
  const json = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      String(url).endsWith("/domains")
        ? json({ data: [{ id: "d1", name: "example.com", status }] })
        : json({ id: "d1", records })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Resend's domain status", () => {
  it.each([
    ["verified", "verified"],
    ["pending", "pending"],
    ["not_started", "pending"],
    ["failed", "failed"],
    ["temporary_failure", "failed"],
    // A feature that did not verify needs fixing, not waiting.
    ["partially_failed", "failed"],
  ])("reads %s as %s", async (resend, status) => {
    stubResend(resend);
    await expect(
      resendDomainStatus({ apiKey: "re_test" }, "example.com")
    ).resolves.toMatchObject({ domain: "example.com", status });
  });

  it("reports a domain whose records couldn't be read as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).endsWith("/domains")
            ? new Response(
                JSON.stringify({
                  data: [{ id: "d1", name: "example.com", status: "pending" }],
                }),
                { status: 200 }
              )
            : new Response("", { status: 429 })
        )
      )
    );
    await expect(
      resendDomainStatus({ apiKey: "re_test" }, "example.com")
    ).resolves.toBeNull();
  });

  it("keeps an MX record's priority, and adds none where there is none", async () => {
    stubResend("pending", [
      {
        type: "MX",
        name: "send",
        value: "feedback-smtp.example.com",
        priority: 10,
      },
      { type: "TXT", name: "send", value: "v=spf1 include:example.com ~all" },
    ]);
    const status = await resendDomainStatus(
      { apiKey: "re_test" },
      "example.com"
    );
    expect(status?.records).toEqual([
      {
        type: "MX",
        name: "send",
        value: "feedback-smtp.example.com",
        priority: 10,
      },
      { type: "TXT", name: "send", value: "v=spf1 include:example.com ~all" },
    ]);
  });
});
