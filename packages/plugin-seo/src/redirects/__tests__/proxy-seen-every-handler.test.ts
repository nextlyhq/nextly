/**
 * Every handler the plugin gives the Proxy notes that the Proxy runs, through
 * the one note-taker they share: a site whose matcher reaches only some of
 * them, or a request only one of them reads, still shows the Proxy as
 * wired.
 */
import type { PluginContext, PluginProxyHandler } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { indexNowKeyProxyHandler } from "../../connections/indexnow";
import { plainCopyProxyHandler } from "../../outputs/ai-outputs";
import type { ReadRules } from "../../resolver/provider";
import { stagingGuard } from "../../staging/guard";
import { redirectsProxyHandler } from "../proxy-handler";
import type { ProxySeenNotes } from "../proxy-seen";

/** Rules read as nothing switched on; a handler that reads them reads this. */
const readRules = (async () => ({})) as unknown as ReadRules;

const ctx = {
  logger: { warn: vi.fn(), error: vi.fn() },
} as unknown as PluginContext;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Each handler, given the note-taker `seen`. */
const handlers: [string, (seen: ProxySeenNotes) => PluginProxyHandler][] = [
  ["the staging guard", seen => stagingGuard(readRules, seen)],
  [
    "redirects",
    seen => redirectsProxyHandler(undefined, undefined, undefined, seen),
  ],
  ["plain-text copies", seen => plainCopyProxyHandler({ readRules }, seen)],
  ["the IndexNow key", seen => indexNowKeyProxyHandler({ readRules }, seen)],
];

describe("the Proxy seen", () => {
  it.each(handlers)("is noted by %s", async (_name, make) => {
    // The staging guard reads the environment alone where it names the site.
    vi.stubEnv("NEXTLY_PRODUCTION_ADDRESSES", "https://acme.example");
    const note = vi.fn(async () => undefined);

    // An admin address: no handler has anything to answer for it, so the
    // note is all that is observed.
    await make({ note }).handle(
      new Request("https://acme.example/admin/settings"),
      ctx
    );

    expect(note).toHaveBeenCalledWith(ctx);
  });
});
