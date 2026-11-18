/**
 * The provided-checks route: each provider run as the person asking, who
 * must be able to change the collection's pages; what a provider answers
 * kept only where it is a finding; a provider that throws or takes too long
 * answered as not run, the others still listed.
 */
import type {
  PageCheckFinding,
  PageCheckProvider,
} from "@nextlyhq/plugin-sdk/blocks";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providedChecksRoute } from "./page-checks-provided-route";

afterEach(() => vi.useRealTimers());

const USER = { id: "u-1" };

function ctxFor(mayUpdate: boolean, user: unknown = USER) {
  const can = vi.fn(() => Promise.resolve(mayUpdate));
  return {
    can,
    ctx: {
      user,
      caller: user === null ? null : { can },
    } as unknown as PluginRouteContext,
  };
}

const ask = (body: unknown) =>
  new Request("http://site.test/x", {
    method: "POST",
    body: JSON.stringify(body),
  });

const PAGE = {
  collection: "pages",
  entryId: "p-1",
  document: { formatVersion: 1, kind: "page", nodes: [] },
};

const finding: PageCheckFinding = {
  what: "Title is too long",
  why: "Search results cut it short.",
  todo: "Shorten the title.",
  fix: { settingsTab: "seo" },
};

async function itemsOf(response: Response) {
  return ((await response.json()) as { items: unknown[] }).items;
}

describe("the provided-checks route", () => {
  it("runs each provider as the person asking, and lists what they find", async () => {
    const check = vi.fn(() => Promise.resolve([finding]));
    const seo: PageCheckProvider = { id: "seo", group: "search", check };
    const { ctx, can } = ctxFor(true);
    const response = await providedChecksRoute(() => [seo]).handler(
      ask(PAGE),
      ctx
    );

    expect(can).toHaveBeenCalledWith("update", "pages", { anyEntry: true });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ collection: "pages", entryId: "p-1" }),
      { access: { as: "user", user: USER } }
    );
    expect(await itemsOf(response)).toEqual([
      { provider: "seo", group: "search", ran: true, findings: [finding] },
    ]);
  });

  it("refuses someone who may not change the collection's pages", async () => {
    const check = vi.fn(() => Promise.resolve([finding]));
    const route = providedChecksRoute(() => [
      { id: "seo", group: "search", check },
    ]);
    await expect(
      route.handler(ask(PAGE), ctxFor(false).ctx)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      route.handler(ask(PAGE), ctxFor(true, null).ctx)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("refuses a body that isn't a page", async () => {
    const route = providedChecksRoute(() => []);
    await expect(
      route.handler(ask({ collection: "", entryId: 3 }), ctxFor(true).ctx)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps only well-formed findings, and a fix of a known kind", async () => {
    const check = vi.fn(() =>
      Promise.resolve([
        finding,
        { what: "", why: "x", todo: "y" },
        "not a finding",
        { ...finding, part: "b", fix: { tab: "colour", id: "x" } },
      ] as unknown as PageCheckFinding[])
    );
    const response = await providedChecksRoute(() => [
      { id: "seo", group: "search", check },
    ]).handler(ask(PAGE), ctxFor(true).ctx);
    const [item] = (await itemsOf(response)) as {
      findings: PageCheckFinding[];
    }[];
    expect(item?.findings).toEqual([
      finding,
      { what: finding.what, why: finding.why, todo: finding.todo, part: "b" },
    ]);
  });

  it("answers a provider that throws or takes too long as not run, and lists the rest", async () => {
    vi.useFakeTimers();
    const broken: PageCheckProvider = {
      id: "broken",
      group: "content",
      check: () => Promise.reject(new Error("boom")),
    };
    const slow: PageCheckProvider = {
      id: "slow",
      group: "content",
      check: () => new Promise(() => undefined),
    };
    const fine: PageCheckProvider = {
      id: "seo",
      group: "search",
      check: () => Promise.resolve([finding]),
    };
    const answering = providedChecksRoute(() => [broken, slow, fine]).handler(
      ask(PAGE),
      ctxFor(true).ctx
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await itemsOf(await answering)).toEqual([
      { provider: "broken", group: "content", ran: false, findings: [] },
      { provider: "slow", group: "content", ran: false, findings: [] },
      { provider: "seo", group: "search", ran: true, findings: [finding] },
    ]);
  });
});
