/**
 * The Proxy handler for plain-text copies while the address record is not
 * ready: the request passes to the site, and a catch-up that failed is tried
 * again, so a site whose only reader is a copy's does not stay without
 * copies until something else asks.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => ({ ready: false, retried: 0 }));

vi.mock("../../address-record/catch-up", () => ({
  addressRecordReady: () => record.ready,
  retryFailedCatchUp: () => {
    record.retried += 1;
  },
}));

import { plainCopyProxyHandler, prefersMarkdown } from "../ai-outputs";

beforeEach(() => {
  record.retried = 0;
});

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
    expect(record.retried).toBe(0);
  });
});

describe("a page's own address", () => {
  it("is left alone, nothing read, unless the request asks for Markdown", async () => {
    record.ready = true;
    try {
      const readRules = vi.fn(async () => ({
        patterns: {},
        plainTextCopies: true,
      }));
      const handler = plainCopyProxyHandler({ readRules });
      const answer = await handler.handle(
        new Request("https://acme.example/blog/hello", {
          headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        }),
        {} as PluginContext
      );
      expect(answer).toBeUndefined();
      expect(readRules).not.toHaveBeenCalled();
    } finally {
      record.ready = false;
    }
  });
});

describe("whether a request asks for Markdown over HTML", () => {
  it.each([
    // As coding agents send it: Markdown named first, at the same weight.
    ["text/markdown, text/html, */*", true],
    ["text/markdown,text/html;q=0.9,*/*;q=0.8", true],
    [
      "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
      true,
    ],
    ["text/markdown", true],
    // As browsers and other readers send it.
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false],
    ["*/*", false],
    ["text/html, text/markdown", false],
    ["text/html;q=1, text/markdown;q=0.5", false],
    // Named only to refuse it.
    ["text/markdown;q=0, text/html", false],
    ["text/markdown;q=0.0", false],
  ])("%s: %s", (accept, asks) => {
    expect(prefersMarkdown(accept)).toBe(asks);
  });

  it("is no where the request names no types", () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown("")).toBe(false);
  });
});
