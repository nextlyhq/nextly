/**
 * A notice IndexNow accepted (`202`) is checked on the host it named: on a
 * site whose languages are served on domains of their own, each host's key
 * file is read, and one that doesn't answer refuses the key, whichever host
 * it is.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADDRESSES_MOVED } from "../../address-record/participant";
import type { ReadRules } from "../../resolver/provider";

/** The key file each host serves, and every address the check read. */
const site = vi.hoisted(() => ({
  serving: new Set<string>(),
  read: [] as string[],
}));

// German pages are served on a domain of their own.
vi.mock("../../languages/versions", async importOriginal => ({
  ...(await importOriginal<typeof import("../../languages/versions")>()),
  servedAt: async (path: string, locale: string) =>
    locale === "de" ? `https://acme.de${path}` : path,
}));

// The live sites, as the key check reads them.
vi.mock("../../received/fetch", async importOriginal => ({
  ...(await importOriginal<typeof import("../../received/fetch")>()),
  fetchAs: async (url: URL) => {
    site.read.push(url.href);
    const key = /^\/([0-9a-f]{32})\.txt$/.exec(url.pathname)?.[1] ?? "";
    const serves = site.serving.has(url.host);
    return {
      kind: "received" as const,
      status: serves ? 200 : 404,
      url: url.href,
      redirects: [],
      headers: {},
      html: serves ? key : "the page",
      ms: 1,
    };
  },
}));

const { flushIndexNow, watchForIndexNow } = await import("../indexnow");

/** A plugin context holding its settings in memory, IndexNow answering 202. */
function contextOf() {
  let stored: Record<string, unknown> = {};
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const ctx = {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    hooks: { on: vi.fn() },
    events: {
      on: (name: string, listener: (event: { payload: unknown }) => void) => {
        listeners.set(name, listener);
      },
    },
    settings: {
      get: async () => stored,
      set: async (patch: Record<string, unknown>) => {
        const next = { ...stored };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        stored = next;
      },
    },
    fetch: async () => new Response(null, { status: 202 }),
  } as unknown as PluginContext;
  return {
    ctx,
    stored: () => stored,
    emit: (name: string, payload: unknown) =>
      listeners.get(name)?.({ payload }),
  };
}

const readRules = (async () => ({
  indexNow: true,
  productionAddresses: ["https://acme.example", "https://acme.de"],
})) as unknown as ReadRules;

/** IndexNow told of one English and one German page, then the notice sent. */
async function tellOfTwoLanguages() {
  const { ctx, stored, emit } = contextOf();
  const stop = watchForIndexNow(ctx, { readRules }, { collections: [] });
  emit(ADDRESSES_MOVED, {
    moves: [
      {
        released: [],
        holds: [
          { locale: "en", path: "/about" },
          { locale: "de", path: "/ueber" },
        ],
      },
    ],
  });
  await flushIndexNow();
  await stop();
  return stored().indexNowLast as { result: string } | undefined;
}

afterEach(() => {
  site.serving.clear();
  site.read.length = 0;
});

describe("an accepted IndexNow notice", () => {
  it("reads the key file on every host a notice named", async () => {
    site.serving.add("acme.example");
    site.serving.add("acme.de");

    expect((await tellOfTwoLanguages())?.result).toBe("accepted");
    expect(site.read.map(address => new URL(address).host).sort()).toEqual([
      "acme.de",
      "acme.example",
    ]);
  });

  it("refuses the key where a language's own host doesn't serve it", async () => {
    site.serving.add("acme.example");

    expect((await tellOfTwoLanguages())?.result).toBe("refused-key");
  });

  it("refuses the key where the first host doesn't serve it, however the other does", async () => {
    site.serving.add("acme.de");

    expect((await tellOfTwoLanguages())?.result).toBe("refused-key");
  });
});
