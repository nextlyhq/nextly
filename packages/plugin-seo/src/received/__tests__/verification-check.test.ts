/**
 * The check behind "Found on the live home page": each production address's
 * home page read once, as Google reads it, by Inspect's fetch, and each saved
 * tag found only where the page carries it with the saved code. Nothing is
 * fetched where no code is saved or no production address is known, and a
 * home page that cannot be read says why.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { Resolve, Transport, TransportRequest } from "../fetch";
import { checkVerification } from "../verification-check";

const PUBLIC: Record<string, string[]> = {
  "example.com": ["93.184.216.34"],
  "example.de": ["93.184.216.35"],
};

const resolve: Resolve = name =>
  Promise.resolve(
    (PUBLIC[name] ?? []).map(address => ({ address, family: 4 as const }))
  );

/** A transport answering each address with `pages`, recording each request. */
function serving(
  pages: Record<string, { status: number; body: string }>
): Transport & { asked: TransportRequest[] } {
  const asked: TransportRequest[] = [];
  const transport: Transport = request => {
    asked.push(request);
    const page = pages[request.url.href] ?? { status: 404, body: "" };
    return Promise.resolve({
      kind: "answer",
      status: page.status,
      headers: {},
      body: page.body,
    });
  };
  return Object.assign(transport, { asked });
}

const ctx = {} as PluginContext;

function setup(
  addresses: string[],
  tags: Record<string, string>,
  transport: Transport,
  baseUrl?: string
) {
  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    readRules: () =>
      Promise.resolve({
        productionAddresses: addresses,
        defaultPatterns: {},
        patterns: {},
      }),
    readTags: () => Promise.resolve(tags),
    fetch: { resolve, transport },
  };
}

const HOME = (tags: string) =>
  `<html><head><title>Home</title>${tags}</head><body></body></html>`;

describe("checkVerification", () => {
  it("finds a saved tag on the home page that carries it with the saved code", async () => {
    const transport = serving({
      "https://example.com/": {
        status: 200,
        body: HOME(
          '<meta name="msvalidate.01" content="8A2F"/><meta name="p:domain_verify" content="old">'
        ),
      },
    });
    const body = await checkVerification(
      ctx,
      setup(
        ["https://example.com"],
        { "msvalidate.01": "8A2F", "p:domain_verify": "a91c" },
        transport
      )
    );
    expect(body.homePages).toEqual([
      { address: "https://example.com", read: true },
    ]);
    expect(body.tags).toEqual([
      { name: "msvalidate.01", foundAt: ["https://example.com"] },
      { name: "p:domain_verify", foundAt: [] },
    ]);
    expect(
      transport.asked.map(request => request.headers["user-agent"])
    ).toEqual([expect.stringContaining("Googlebot")]);
  });

  it("does not count a tag written inside a script or a comment", async () => {
    const transport = serving({
      "https://example.com/": {
        status: 200,
        body: HOME(
          '<!-- <meta name="msvalidate.01" content="8A2F"> --><script>"<meta name=\\"msvalidate.01\\" content=\\"8A2F\\">"</script>'
        ),
      },
    });
    const body = await checkVerification(
      ctx,
      setup(["https://example.com"], { "msvalidate.01": "8A2F" }, transport)
    );
    expect(body.tags).toEqual([{ name: "msvalidate.01", foundAt: [] }]);
  });

  it("reads the home page at every production address", async () => {
    const transport = serving({
      "https://example.com/": {
        status: 200,
        body: HOME('<meta name="msvalidate.01" content="8A2F">'),
      },
      "https://example.de/": { status: 200, body: HOME("") },
    });
    const body = await checkVerification(
      ctx,
      setup(
        ["https://example.com", "https://example.de"],
        { "msvalidate.01": "8A2F" },
        transport
      )
    );
    expect(body.tags).toEqual([
      { name: "msvalidate.01", foundAt: ["https://example.com"] },
    ]);
    expect(body.homePages.map(page => page.read)).toEqual([true, true]);
  });

  it("says why a home page could not be read", async () => {
    const transport = serving({
      "https://example.com/": { status: 503, body: "" },
    });
    const body = await checkVerification(
      ctx,
      setup(["https://example.com"], { "msvalidate.01": "8A2F" }, transport)
    );
    expect(body.homePages).toEqual([
      {
        address: "https://example.com",
        read: false,
        message: "The home page answered 503.",
      },
    ]);
    expect(body.tags).toEqual([{ name: "msvalidate.01", foundAt: [] }]);
  });

  it("fetches nothing where no code is saved", async () => {
    const transport = serving({});
    const body = await checkVerification(
      ctx,
      setup(["https://example.com"], {}, transport)
    );
    expect(body).toMatchObject({ homePages: [], tags: [] });
    expect(transport.asked).toHaveLength(0);
  });

  it("fetches nothing where no production address is known", async () => {
    const transport = serving({});
    const body = await checkVerification(
      ctx,
      setup([], { "msvalidate.01": "8A2F" }, transport)
    );
    expect(body).toMatchObject({ homePages: [], tags: [] });
    expect(transport.asked).toHaveLength(0);
  });
});

describe("a site with more production addresses than one check reads", () => {
  it("lists the addresses it did not read as not read, so none is called found", async () => {
    const addresses = Array.from(
      { length: 6 },
      (_, index) => `https://site${index}.example.com`
    );
    const pages = Object.fromEntries(
      addresses.map(address => [
        `${address}/`,
        {
          status: 200,
          body: HOME('<meta name="msvalidate.01" content="8A2F">'),
        },
      ])
    );
    const resolveAll: Resolve = () =>
      Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]);
    const body = await checkVerification(ctx, {
      ...setup(addresses, { "msvalidate.01": "8A2F" }, serving(pages)),
      fetch: { resolve: resolveAll, transport: serving(pages) },
    });
    expect(body.homePages.map(page => page.address)).toEqual(addresses);
    expect(body.homePages[5]).toEqual({
      address: "https://site5.example.com",
      read: false,
      message: "Not checked: one check reads the first 5 addresses.",
    });
    expect(body.tags[0]?.foundAt).toHaveLength(5);
  });
});

describe("where the tag must be", () => {
  it("does not count a tag in the body, only in the head", async () => {
    const transport = serving({
      "https://example.com/": {
        status: 200,
        body: '<html><head><title>Home</title></head><body><meta name="msvalidate.01" content="8A2F"></body></html>',
      },
    });
    const body = await checkVerification(
      ctx,
      setup(["https://example.com"], { "msvalidate.01": "8A2F" }, transport)
    );
    expect(body.tags).toEqual([{ name: "msvalidate.01", foundAt: [] }]);
  });
});

describe("which addresses are checked", () => {
  it("checks the production addresses, and the configured origin only where none is known", async () => {
    const pages = {
      "https://example.com/": {
        status: 200,
        body: HOME('<meta name="msvalidate.01" content="8A2F">'),
      },
      "https://old.example.com/": { status: 503, body: "" },
    };
    const both = await checkVerification(
      ctx,
      setup(
        ["https://example.com"],
        { "msvalidate.01": "8A2F" },
        serving(pages),
        "https://old.example.com"
      )
    );
    expect(both.homePages).toEqual([
      { address: "https://example.com", read: true },
    ]);
    const fallback = await checkVerification(
      ctx,
      setup(
        [],
        { "msvalidate.01": "8A2F" },
        serving(pages),
        "https://example.com"
      )
    );
    expect(fallback.homePages).toEqual([
      { address: "https://example.com", read: true },
    ]);
  });
});
