/**
 * `notFoundLogged` answers not found every time, and logs the request's
 * address once, after the response, only where the SEO plugin runs and the
 * site's Proxy passed the request on.
 *
 * What separates it from a plausible broken helper:
 *
 * - a request whose page and head both answer not found is logged once, not
 *   twice (both calls schedule a write; the second must find it logged);
 * - nothing is written before the response is finished: the write waits for
 *   `after`;
 * - a request the Proxy did not pass on, or a process where the plugin never
 *   started, logs nothing, and still answers not found;
 * - the request is read before the answer, wherever the plugin runs, so a
 *   prerender never keeps a 404 that later requests would be served unlogged;
 * - a failure to read the request leaves the miss unlogged rather than
 *   turning the 404 into an error, while Next.js's own interrupts pass on.
 *
 * Next.js's request APIs are stood in for: `headers()` answers the request
 * a test sets, `after` holds its callbacks until the test finishes the
 * response, and `notFound()` throws as Next's does, by its digest.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const next = vi.hoisted(() => ({
  request: new Headers() as Headers | Error | "waits",
  pending: [] as Array<() => unknown>,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (next.request instanceof Error) throw next.request;
    // A prerender's read, which waits for a request that never comes.
    if (next.request === "waits") return await new Promise<never>(() => {});
    return next.request;
  },
}));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    next.pending.push(task);
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

/** Finish the response: run what `after` was handed. */
async function finishResponse(): Promise<void> {
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
  next.request = new Headers();
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
    expect(next.pending).toEqual([]);
  });

  it("reads the request before answering, so a prerender never keeps the answer", async () => {
    // Where the plugin has not started, as during a build, too.
    delete shared.__nextly_seoLogNotFound;
    next.request = "waits";
    let settled = false;
    void notFoundLogged().catch(() => {
      settled = true;
    });
    await new Promise(done => setTimeout(done, 20));
    expect(settled).toBe(false);
  });

  it("answers not found when the request cannot be read, and passes Next's interrupts on", async () => {
    next.request = new Error("headers() inside a cache scope");
    await expect(notFoundLogged()).rejects.toMatchObject(NOT_FOUND);
    expect(next.pending).toEqual([]);

    const interrupt = Object.assign(new Error("waiting for a request"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    next.request = interrupt;
    await expect(notFoundLogged()).rejects.toBe(interrupt);
  });
});
