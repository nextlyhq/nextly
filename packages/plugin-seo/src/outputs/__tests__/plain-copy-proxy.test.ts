/**
 * The Proxy handler for plain-text copies while the address record is not
 * ready: the request passes to the site, and a catch-up that failed is tried
 * again, so a site whose only reader is a copy's does not stay without
 * copies until something else asks.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => ({ ready: false, retried: 0 }));

vi.mock("../../address-record/catch-up", () => ({
  addressRecordReady: () => record.ready,
  retryFailedCatchUp: () => {
    record.retried += 1;
  },
}));

import { plainCopyProxyHandler } from "../ai-outputs";

describe("a copy asked for before the address record is ready", () => {
  it("passes to the site and tries a failed catch-up again", async () => {
    const readRules = vi.fn(async () => ({
      patterns: {},
      plainTextCopies: true,
    }));
    const handler = plainCopyProxyHandler({ readRules });
    const answer = await handler.handle(
      new Request("https://acme.example/blog/hello.md"),
      {} as PluginContext
    );
    expect(answer).toBeUndefined();
    expect(record.retried).toBe(1);
    // Nothing else is read while the record is not ready.
    expect(readRules).not.toHaveBeenCalled();
  });

  it("leaves an address that is not a copy's alone", async () => {
    const handler = plainCopyProxyHandler({
      readRules: async () => ({ patterns: {} }),
    });
    await handler.handle(
      new Request("https://acme.example/blog/hello"),
      {} as PluginContext
    );
    expect(record.retried).toBe(1);
  });
});
