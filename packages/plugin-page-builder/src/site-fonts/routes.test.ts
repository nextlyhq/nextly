/**
 * The catalogue route's reading of Fontsource: the list, and how popular each
 * family is, read together and kept for the catalogue's own day.
 *
 * The transport is a stand-in answering by path, so these pin what the route
 * asks for and what it makes of each answer; the integration suite drives the
 * same route over HTTP against a local catalogue.
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { resolveFontOptions } from "./options";
import { appendNewFaces, siteFontRoutes } from "./routes";

const API = "https://api.example.test";

const ENTRY = {
  subsets: ["latin"],
  weights: [400],
  styles: ["normal"],
  defSubset: "latin",
  variable: false,
  category: "serif",
  license: "OFL-1.1",
  type: "google",
};

const LIST = [
  { ...ENTRY, id: "abel", family: "Abel" },
  { ...ENTRY, id: "lora", family: "Lora" },
];

const STATS = { lora: { total: { npmDownloadMonthly: 52_000 } } };

type Answer = () => Response;

const json =
  (body: unknown): Answer =>
  () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

/** A catalogue answering each path it knows, and 404 for any other. */
function catalogueAt(routes: Record<string, Answer>) {
  const asked: string[] = [];
  const fetch = async (input: string): Promise<Response> => {
    const url = new URL(input);
    const path = `${url.pathname}${url.search}`;
    asked.push(path);
    return routes[path]?.() ?? new Response(null, { status: 404 });
  };
  return { asked, fetch };
}

function catalogueRoute(clock: { now: number }) {
  const fonts = resolveFontOptions({
    catalogue: { api: API, files: "https://files.example.test" },
  });
  if (fonts === false) throw new Error("the catalogue is on");
  const [read] = siteFontRoutes({ fonts, now: () => clock.now });
  if (read === undefined) throw new Error("no catalogue route");
  return read;
}

async function readItems(
  route: ReturnType<typeof catalogueRoute>,
  fetch: (input: string) => Promise<Response>
): Promise<Array<Record<string, unknown>>> {
  const response = await route.handler(new Request(`${API}/catalogue`), {
    self: { collections: {}, singles: {} },
    user: null,
    caller: { can: async () => true },
    fetch,
  } as unknown as Parameters<typeof route.handler>[1]);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    items: Array<Record<string, unknown>>;
    meta: Record<string, unknown>;
  };
  // The canonical list envelope, whatever the stats said.
  expect(body.meta).toMatchObject({ total: body.items.length, page: 1 });
  return body.items;
}

describe("the catalogue route's popularity", () => {
  it("gives each family its monthly downloads, and 0 to one the stats leave out", async () => {
    const { fetch } = catalogueAt({
      "/v1/fonts?type=google": json(LIST),
      "/v1/stats": json(STATS),
    });
    const items = await readItems(catalogueRoute({ now: 0 }), fetch);
    expect(items.map(item => [item.id, item.popularity])).toEqual([
      ["abel", 0],
      ["lora", 52_000],
    ]);
  });

  it("answers the list without popularity when the stats fail or cannot be read", async () => {
    for (const stats of [
      () => new Response(null, { status: 503 }),
      json(["not", "stats"]),
      () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ]) {
      const { fetch } = catalogueAt({
        "/v1/fonts?type=google": json(LIST),
        "/v1/stats": stats,
      });
      const items = await readItems(catalogueRoute({ now: 0 }), fetch);
      expect(items.map(item => item.id)).toEqual(["abel", "lora"]);
      for (const item of items) expect(item).not.toHaveProperty("popularity");
    }
  });

  it("reads the stats once per catalogue read, and again only when the catalogue is", async () => {
    const { asked, fetch } = catalogueAt({
      "/v1/fonts?type=google": json(LIST),
      "/v1/stats": json(STATS),
    });
    const clock = { now: 0 };
    const route = catalogueRoute(clock);
    await readItems(route, fetch);
    await readItems(route, fetch);
    expect(asked.filter(path => path === "/v1/stats")).toHaveLength(1);

    clock.now += 25 * 60 * 60 * 1000;
    const items = await readItems(route, fetch);
    expect(asked.filter(path => path === "/v1/stats")).toHaveLength(2);
    expect(items.find(item => item.id === "lora")?.popularity).toBe(52_000);
  });

  it("settles the stats it asked for before answering, when a refresh of the list fails", async () => {
    let listAnswer: Answer = json(LIST);
    let statsAnswered = 0;
    const { fetch } = catalogueAt({
      "/v1/fonts?type=google": () => listAnswer(),
      "/v1/stats": json(STATS),
    });
    // The stats answer a moment after the list, as a slower host would.
    const slowStats = async (input: string): Promise<Response> => {
      if (!input.endsWith("/v1/stats")) return fetch(input);
      await new Promise(resolve => setTimeout(resolve, 20));
      const answer = await fetch(input);
      statsAnswered += 1;
      return answer;
    };
    const clock = { now: 0 };
    const route = catalogueRoute(clock);
    await readItems(route, slowStats);
    expect(statsAnswered).toBe(1);

    listAnswer = () => new Response(null, { status: 503 });
    clock.now += 25 * 60 * 60 * 1000;
    const items = await readItems(route, slowStats);
    // The last good copy, and no stats read still running behind it.
    expect(items.find(item => item.id === "lora")?.popularity).toBe(52_000);
    expect(statsAnswered).toBe(2);
  });
});

/** A face of Lora at `weight`, its file at `id`. */
const lora = (weight: string, id: string): FontFaceDef => ({
  family: "Lora",
  weight,
  style: "normal",
  unicodeRange: "U+0000-00FF",
  src: [{ url: `/api/media/${id}/raw`, format: "woff2" }],
});

/**
 * The site style's Single holding each of `docs` in turn, at version 1, 2,
 * …; a write sent with any version but the newest is refused as stale.
 */
function singleOver(...docs: { fonts: unknown[] }[]) {
  let at = 0;
  const findSingle = vi.fn(async () => {
    const doc = docs[Math.min(at, docs.length - 1)];
    at += 1;
    return { ...doc, _rev: String(Math.min(at, docs.length)) };
  });
  const updateSingle = vi.fn(
    async (args: { data: Record<string, unknown> }): Promise<unknown> => {
      if (args.data._rev !== String(docs.length)) {
        throw NextlyError.staleVersion({
          data: { currentVersion: String(docs.length) },
        });
      }
      return {};
    }
  );
  return { findSingle, updateSingle };
}

describe("appending an add's faces to the site's fonts", () => {
  const brand = {
    family: "Brand",
    src: [{ url: "/api/media/brand/raw", format: "woff2" }],
  };

  it("appends again to what is stored after a save refused the first write", async () => {
    const api = singleOver({ fonts: [] }, { fonts: [brand] });
    const added = [lora("400", "m1"), lora("700", "m2")];
    expect(await appendNewFaces(api, "site-style", added, {})).toEqual(added);
    expect(api.updateSingle).toHaveBeenCalledTimes(2);
    // The second write keeps the face saved meanwhile, with its version.
    expect(api.updateSingle.mock.calls[1]?.[0].data).toEqual({
      fonts: [brand, ...added],
      _rev: "2",
    });
  });

  it("leaves out a face another add stored meanwhile, and answers only those appended", async () => {
    const theirs = lora("400", "theirs");
    const api = singleOver({ fonts: [] }, { fonts: [theirs] });
    const mine = [lora("400", "m1"), lora("700", "m2")];
    expect(await appendNewFaces(api, "site-style", mine, {})).toEqual([
      mine[1],
    ]);
    expect(api.updateSingle.mock.calls[1]?.[0].data).toEqual({
      fonts: [theirs, mine[1]],
      _rev: "2",
    });
  });

  it("writes nothing more when every face was stored meanwhile", async () => {
    const api = singleOver(
      { fonts: [] },
      { fonts: [lora("400", "t1"), lora("700", "t2")] }
    );
    const mine = [lora("400", "m1"), lora("700", "m2")];
    expect(await appendNewFaces(api, "site-style", mine, {})).toEqual([]);
    expect(api.updateSingle).toHaveBeenCalledTimes(1);
  });

  it("answers the stale refusal once three writes in all were refused", async () => {
    const api = singleOver(
      { fonts: [] },
      { fonts: [] },
      { fonts: [] },
      { fonts: [] }
    );
    await expect(
      appendNewFaces(api, "site-style", [lora("400", "m1")], {})
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    expect(api.updateSingle).toHaveBeenCalledTimes(3);
  });
});
