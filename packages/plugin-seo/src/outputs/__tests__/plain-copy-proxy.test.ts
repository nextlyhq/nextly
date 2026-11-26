/**
 * The Proxy handler for plain-text copies while the address record is not
 * ready: a copy's own address is asked to come back once the wait for the
 * record runs out, rather than passed to a site that serves no page there,
 * and a catch-up that failed is tried again, so a site whose only reader is
 * a copy's does not stay without copies until something else asks.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => ({ ready: false, retried: 0, holdersRead: 0 }));

vi.mock("../../address-record/catch-up", () => ({
  addressRecordReady: () => record.ready,
  // Waits for nothing here: the wait itself is the catch-up's own test's.
  addressRecordReadyWithin: async () => record.ready,
  retryFailedCatchUp: () => {
    record.retried += 1;
  },
}));

// The record holds no page at any address here: each read of it is the
// handler's question whether the site serves a copy's address itself.
vi.mock("../../address-record/participant", () => ({
  addressHolders: async () => {
    record.holdersRead += 1;
    return [];
  },
  withAddressHolders: async (
    _ctx: unknown,
    _language: unknown,
    _paths: unknown,
    run: () => Promise<void>
  ) => run(),
}));

import { plainCopyProxyHandler, prefersMarkdown } from "../ai-outputs";

beforeEach(() => {
  record.retried = 0;
  record.holdersRead = 0;
});

describe("a copy asked for before the address record is ready", () => {
  it("asks the reader to come back, never kept, and tries a failed catch-up again", async () => {
    const readRules = vi.fn(async () => ({
      patterns: {},
      plainTextCopies: true,
    }));
    const handler = plainCopyProxyHandler({ readRules });
    const answer = await handler.handle(
      new Request("https://acme.example/blog/hello.md"),
      {} as PluginContext
    );
    // Not passed to the site, which serves no page there and would answer
    // not found: the sitemap's answer while the record catches up.
    expect(answer?.response?.status).toBe(503);
    expect(answer?.response?.headers.get("retry-after")).toBe("120");
    expect(answer?.response?.headers.get("cache-control")).toBe("no-store");
    expect(record.retried).toBe(1);
    // Read while the record is not ready: whether copies are served, and
    // whether a page of the site holds the address.
    expect(readRules).toHaveBeenCalledTimes(1);
    expect(record.holdersRead).toBe(1);
  });

  it("passes to the site a page the site serves at a copy's address", async () => {
    // A page built in code at `/guide.md`: the site's, whatever the record says.
    const handler = plainCopyProxyHandler({
      readRules: async () => ({ patterns: {}, plainTextCopies: true }),
      codeRoutes: () => [
        { path: "/guide.md", source: "built", route: "app/guide.md/page.tsx" },
      ],
    });
    const answer = await handler.handle(
      new Request("https://acme.example/guide.md"),
      {} as PluginContext
    );
    expect(answer).toBeUndefined();
    // Before anything has started too: the Proxy never holds it for the start.
    expect(handler.claims?.(new Request("https://acme.example/guide.md"))).toBe(
      false
    );
    expect(handler.claims?.(new Request("https://acme.example/hello.md"))).toBe(
      true
    );
    // Not held for the record either: nothing is read before it passes.
    expect(record.holdersRead).toBe(0);
  });

  it("passes to the site where copies are switched off", async () => {
    const handler = plainCopyProxyHandler({
      readRules: async () => ({ patterns: {} }),
    });
    const answer = await handler.handle(
      new Request("https://acme.example/notes/readme.md"),
      {} as PluginContext
    );
    expect(answer).toBeUndefined();
  });

  it("passes a page's own address asked for by Accept to the page, reading nothing", async () => {
    const readRules = vi.fn(async () => ({
      patterns: {},
      plainTextCopies: true,
    }));
    const handler = plainCopyProxyHandler({ readRules });
    const answer = await handler.handle(
      new Request("https://acme.example/blog/hello", {
        headers: { accept: "text/markdown" },
      }),
      {} as PluginContext
    );
    expect(answer).toBeUndefined();
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

describe("which requests the handler claims before the site has started", () => {
  const handler = plainCopyProxyHandler({
    readRules: async () => ({ patterns: {} }),
  });
  it.each([
    ["a copy's own address", "/blog/hello.md", {}, "GET", true],
    ["a copy's own address, by HEAD", "/blog/hello.md", {}, "HEAD", true],
    // A page answers these itself.
    ["a page", "/blog/hello", {}, "GET", false],
    [
      "a page asked for as Markdown",
      "/blog/hello",
      { accept: "text/markdown" },
      "GET",
      false,
    ],
    ["a form posted to a .md address", "/blog/hello.md", {}, "POST", false],
    [
      "the page a copy is made from",
      "/blog/hello.md",
      { "x-nextly-plain-copy": "1" },
      "GET",
      false,
    ],
  ])("%s: %s", (_, path, headers, method, claimed) => {
    expect(
      handler.claims?.(
        new Request(`https://acme.example${path}`, { method, headers })
      )
    ).toBe(claimed);
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
    // HTML weighted through a wildcard, as specifically as it is named.
    ["text/markdown;q=0.1, */*;q=1", false],
    ["text/markdown;q=0.5, text/*;q=0.8", false],
    ["text/*, text/markdown", false],
    ["text/markdown, */*;q=0.1", true],
    ["text/markdown;q=0.9, text/*;q=0.8, text/html;q=0.5", true],
  ])("%s: %s", (accept, asks) => {
    expect(prefersMarkdown(accept)).toBe(asks);
  });

  it("is no where the request names no types", () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown("")).toBe(false);
  });
});
