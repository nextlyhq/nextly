/**
 * `notFoundLogged` answers not found every time, at once, and logs the
 * address of a request it answers once, after the response, only where the
 * SEO plugin runs and the site's Proxy passed the request on.
 *
 * What separates it from a plausible broken helper:
 *
 * - a render made without a request (the prerender Next.js keeps under Cache
 *   Components) is answered at once and reads nothing of the request, so the
 *   404 is kept rather than turned into a 200 for every request; a helper
 *   that read the request first, as it once did, never answers there;
 * - a render made for a request logs its address, though nothing waited for
 *   the request before answering;
 * - a request whose page and head both answer not found is logged once, not
 *   twice (both calls schedule a write; the second must find it logged);
 * - nothing is written before the response is finished: the write waits for
 *   `after`;
 * - a request the Proxy did not pass on, or a process where the plugin never
 *   started, logs nothing, and still answers not found;
 * - a request that cannot be known or read leaves the miss unlogged rather
 *   than turning the 404 into an error, while Next.js's own interrupts pass
 *   on.
 *
 * Next.js's request APIs are stood in for: `connection()` resolves where a
 * test answers a request and waits where it prerenders, `headers()` answers
 * the request a test sets and counts its reads, `after` holds its callbacks
 * until the test finishes the response, and `notFound()` throws as Next's
 * does, by its digest.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => ({
  /** What `connection()` does: a request's render, a prerender, or a throw. */
  render: "request" as "request" | "prerender" | Error,
  request: new Headers() as Headers | Error,
  reads: 0,
  pending: [] as Array<() => unknown>,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    next.reads += 1;
    if (next.request instanceof Error) throw next.request;
    return next.request;
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    next.pending.push(task);
  },
  connection: () => {
    if (next.render instanceof Error) throw next.render;
    // A prerender's, which waits for a request that never comes.
    if (next.render === "prerender") return new Promise<never>(() => {});
    return Promise.resolve();
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  // Rethrows Next's own interrupts, by digest, as Next's does.
  unstable_rethrow: (error: unknown) => {
    if ((error as { digest?: unknown }).digest !== undefined) throw error;
  },
}));

const recorded = vi.hoisted(
  () => [] as Array<{ locale: string; path: string; asked?: string }>
);
vi.mock("../../not-found/log", () => ({
  recordNotFound: async (
    _ctx: unknown,
    address: { locale: string; path: string; asked?: string }
  ) => {
    recorded.push(address);
  },
}));

import {
  ASKED_FOR_HEADER,
  REQUEST_HEADER,
} from "../../redirects/proxy-handler";
import { keepSeoContext } from "../../not-found/report";
import { notFoundLogged } from "../index";

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** The SEO plugin's context, as far as the log reads it. */
const ctx = {
  publicAddresses: { defaultLanguage: async () => "en" },
  logger: { warn: () => undefined },
} as unknown as PluginContext;

/** A request the site's Proxy passed on, for `path`, with its own id. */
function passedOn(path: string, id: string): Headers {
  return new Headers({
    [ASKED_FOR_HEADER]: `https://example.com${path}`,
    [REQUEST_HEADER]: id,
  });
}

/** Let the render's own work run: what the helper started without awaiting it. */
async function settle(): Promise<void> {
  await new Promise(done => setTimeout(done, 0));
}

/** Finish the response: run what `after` was handed. */
async function finishResponse(): Promise<void> {
  await settle();
  const tasks = next.pending.splice(0);
  for (const task of tasks) await task();
}

const shared = globalThis as {
  __nextly_seoPluginContext?: unknown;
  __nextly_seoLogNotFound?: unknown;
};

beforeEach(() => {
  recorded.length = 0;
  next.pending.length = 0;
  next.render = "request";
  next.request = new Headers();
  next.reads = 0;
  keepSeoContext(ctx);
});

afterEach(() => {
  delete shared.__nextly_seoPluginContext;
  delete shared.__nextly_seoLogNotFound;
});

describe("notFoundLogged", () => {
  it("answers not found, and logs the address once the response is finished", async () => {
    next.request = passedOn("/gone", "request-1");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    expect(recorded).toEqual([]);

    await finishResponse();
    expect(recorded).toEqual([{ locale: "en", path: "/gone", asked: "/gone" }]);
  });

  it("logs a request once, though its page and its head both answer it", async () => {
    next.request = passedOn("/twice", "request-2");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(recorded.map(address => address.path)).toEqual(["/twice"]);

    // Another request for the same address is another visit.
    next.request = passedOn("/twice", "request-3");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(recorded.map(address => address.path)).toEqual(["/twice", "/twice"]);
  });

  it("logs nothing for a request the Proxy did not pass on", async () => {
    // What the Proxy sends on for a prefetch, the admin or an asset.
    next.request = new Headers({
      [ASKED_FOR_HEADER]: "",
      [REQUEST_HEADER]: "",
    });
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(recorded).toEqual([]);
  });

  it("logs nothing where the plugin never started, and still answers not found", async () => {
    delete shared.__nextly_seoLogNotFound;
    next.request = passedOn("/gone", "request-4");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await settle();
    expect(next.pending).toEqual([]);
  });

  it("answers a render made without a request at once, reading nothing of the request", async () => {
    next.render = "prerender";
    next.request = passedOn("/kept", "request-5");
    let answer: unknown = "still waiting";
    void notFoundLogged().catch((error: unknown) => {
      answer = error;
    });
    await settle();
    expect(answer).toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(next.reads).toBe(0);
    expect(next.pending).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("answers not found when the request cannot be known or read, and passes Next's interrupts on", async () => {
    next.render = new Error("connection() inside a cache scope");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(next.pending).toEqual([]);

    next.render = "request";
    next.request = new Error("headers() read too late");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    await finishResponse();
    expect(recorded).toEqual([]);

    // A page generated statically without Cache Components.
    const interrupt = Object.assign(new Error("dynamic usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    next.render = interrupt;
    await expect(notFoundLogged()).rejects.toBe(interrupt);
  });
});
