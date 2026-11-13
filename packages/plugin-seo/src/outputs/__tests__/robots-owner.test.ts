/**
 * Whether the site serves a robots.txt of its own, which wins over the
 * plugin's: read from the site's own robots.txt at its production address,
 * by Inspect's fetch, as the header the plugin marks its file with. A file
 * without the header is the site's; a read that fails says nothing, so the
 * plugin's rules are judged as served.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  Resolve,
  Transport,
  TransportRequest,
} from "../../received/fetch";
import { forgetRobotsOwner, siteServesOwnRobots } from "../robots-owner";

const resolve: Resolve = () =>
  Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]);

function serving(answer: {
  status: number;
  headers?: Record<string, string>;
}): Transport & { asked: TransportRequest[] } {
  const asked: TransportRequest[] = [];
  const transport: Transport = request => {
    asked.push(request);
    return Promise.resolve({
      kind: "answer",
      status: answer.status,
      headers: answer.headers ?? {},
      body: "User-agent: *\nAllow: /\n",
    });
  };
  return Object.assign(transport, { asked });
}

const ctx = {} as PluginContext;
const site = (addresses: string[]) => () =>
  Promise.resolve({ patterns: {}, productionAddresses: addresses });

beforeEach(() => forgetRobotsOwner());

describe("siteServesOwnRobots", () => {
  it("is false where the plugin's header marks the file", async () => {
    const transport = serving({
      status: 200,
      headers: { "x-nextly-robots": "plugin-seo" },
    });
    expect(
      await siteServesOwnRobots(ctx, {
        readRules: site(["https://example.com"]),
        fetch: { resolve, transport },
      })
    ).toBe(false);
    expect(transport.asked[0]?.url.href).toBe("https://example.com/robots.txt");
  });

  it("is true for a file without the header, the site's own", async () => {
    expect(
      await siteServesOwnRobots(ctx, {
        readRules: site(["https://example.com"]),
        fetch: { resolve, transport: serving({ status: 200 }) },
      })
    ).toBe(true);
  });

  it("is false where the file can't be read, or no address is known", async () => {
    expect(
      await siteServesOwnRobots(ctx, {
        readRules: site(["https://example.com"]),
        fetch: { resolve, transport: serving({ status: 503 }) },
      })
    ).toBe(false);
    forgetRobotsOwner();
    const transport = serving({ status: 200 });
    expect(
      await siteServesOwnRobots(ctx, {
        readRules: site([]),
        fetch: { resolve, transport },
      })
    ).toBe(false);
    expect(transport.asked).toHaveLength(0);
  });

  it("reads the file once for a while, not on every page checked", async () => {
    const transport = serving({ status: 200 });
    const setup = {
      readRules: site(["https://example.com"]),
      fetch: { resolve, transport },
    };
    await siteServesOwnRobots(ctx, setup);
    await siteServesOwnRobots(ctx, setup);
    expect(transport.asked).toHaveLength(1);
  });
});
