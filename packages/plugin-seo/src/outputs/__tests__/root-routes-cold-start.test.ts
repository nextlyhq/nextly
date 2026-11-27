/**
 * A server just started answers the sitemap and llms.txt on its first
 * request where the stored fingerprint is current: the start's catch-up is
 * still reading it when the request comes, and the request waits for that
 * read rather than answering 503. Every new instance of a serverless site is
 * such a server, so answering 503 there answers it once per instance.
 */
import type { PluginContext, PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

/** The notes the stored gate reads: a run that finished, at fingerprint `fp`. */
const stored = vi.hoisted(() => ({ notes: new Map<string, string>() }));

vi.mock("../../address-record/store", async importOriginal => {
  const store =
    await importOriginal<typeof import("../../address-record/store")>();
  stored.notes.set(store.noteKey("fingerprint"), "fp");
  stored.notes.set(store.noteKey("site-types"), JSON.stringify(["posts"]));
  return {
    ...store,
    readNotes: async (_ctx: unknown, keys: readonly string[]) => ({
      notes: new Map(
        keys.flatMap(key => {
          const value = stored.notes.get(key);
          return value === undefined ? [] : [[key, value] as const];
        })
      ),
      pending: false,
    }),
    putNote: async (_ctx: unknown, key: string, value: string) => {
      stored.notes.set(key, value);
    },
    earlierWritesSince: async () => undefined,
  };
});

// The listing and the llms files' words are their own tests': here, only
// whether the answer waits for the record.
vi.mock("../listing", () => ({ listPages: async () => ({ pages: [] }) }));
vi.mock("../ai-outputs", () => ({
  llmsTxtOf: async () => "# Acme\n",
  llmsFullTxtOf: async () => "# Acme\n",
}));

import { startCatchUp } from "../../address-record/catch-up";
import { rootFileRoutes } from "../root-routes";
import { SITEMAP_LIMITS } from "../sitemap-files";

const SITE = "https://acme.example";

/**
 * The SEO plugin's context on a server just started: its fingerprint, the
 * first thing its start's catch-up reads, answered only once `read` is
 * called, as a read of a database the new instance has only just reached.
 */
function justStarted(): { ctx: PluginContext; read: () => void } {
  let read: () => void = () => undefined;
  const ctx = {
    logger: {
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
    },
    publicAddresses: {
      fingerprint: () =>
        new Promise<string>(resolve => {
          read = () => resolve("fp");
        }),
    },
    db: {
      withTransactionBounds: <R>(_bounds: unknown, work: () => Promise<R>) =>
        work(),
    },
  } as unknown as PluginContext;
  return { ctx, read: () => read() };
}

const routes = rootFileRoutes({
  origin: SITE,
  readRules: async () => ({ patterns: {}, llmsTxt: true }),
  sitemap: { limits: SITEMAP_LIMITS },
});

/** The answer at `path` of a server just started, its fingerprint read soon after. */
async function firstAnswer(path: string): Promise<Response> {
  const route = routes.find(each => each.path === path);
  if (route === undefined) throw new Error(`no route at ${path}`);
  const { ctx, read } = justStarted();
  // Started at the start, not awaited, as the plugin's `onReady` does.
  const run = startCatchUp(ctx);
  const answering = route.handler(
    new Request(`${SITE}${path}`),
    ctx as PluginRouteContext
  );
  // The read comes back after the request has found the catch-up running.
  await new Promise(resolve => setTimeout(resolve, 20));
  read();
  const answer = await answering;
  await run;
  return answer;
}

describe("a server just started, the stored fingerprint current", () => {
  it("answers the sitemap on its first request", async () => {
    const answer = await firstAnswer("/sitemap.xml");
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("<urlset");
  });

  it("answers llms.txt on its first request", async () => {
    const answer = await firstAnswer("/llms.txt");
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("# Acme\n");
  });
});
