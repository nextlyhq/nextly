/**
 * The New button's recent types: what is stored is a hint, never a grant, so
 * every read drops a type the reader can no longer use, and recording one asks
 * first.
 */
import { describe, expect, it, vi } from "vitest";

import {
  NewTypesService,
  storedNewTypes,
  withNewType,
} from "../new-types-service";

/**
 * A service over an in-memory preference and the collections named.
 * `meanwhile` runs inside each change, before its read: what another change
 * committed between the record's first read and its own.
 */
function serviceWith(
  stored: string | undefined,
  existing: string[],
  meanwhile: (values: Map<string, string>) => void = () => {}
) {
  const values = new Map<string, string>();
  if (stored !== undefined) values.set("u1:new-type", stored);
  const preferences = {
    get: vi.fn(async (userId: string, key: string) =>
      values.get(`${userId}:${key}`)
    ),
    update: vi.fn(
      async (
        userId: string,
        key: string,
        change: (stored: string | undefined) => string
      ) => {
        meanwhile(values);
        const value = change(values.get(`${userId}:${key}`));
        values.set(`${userId}:${key}`, value);
        return value;
      }
    ),
  };
  const service = new NewTypesService({
    preferences,
    collectionExists: async slug => existing.includes(slug),
  });
  return { service, preferences, values };
}

const mayCreateIn =
  (...slugs: string[]) =>
  async (slug: string) =>
    slugs.includes(slug);

describe("a stored list", () => {
  it("reads as its slugs in order, each once", () => {
    expect(storedNewTypes('["posts","pages","posts","faq"]')).toEqual([
      "posts",
      "pages",
      "faq",
    ]);
  });

  it("reads as none when it is not a list of slugs", () => {
    for (const value of [undefined, "", "posts", "{}", "[1, null]"]) {
      expect(storedNewTypes(value)).toEqual([]);
    }
  });

  it("takes a recorded slug first, once, and keeps three", () => {
    expect(withNewType(["pages", "posts", "faq"], "posts")).toEqual([
      "posts",
      "pages",
      "faq",
    ]);
    expect(withNewType(["pages", "posts", "faq"], "news")).toEqual([
      "news",
      "pages",
      "posts",
    ]);
  });
});

describe("the reader's recent types", () => {
  it("keep only collections that exist and that this reader may create in", async () => {
    const { service } = serviceWith('["gone","posts","locked","pages"]', [
      "posts",
      "locked",
      "pages",
    ]);
    // "gone" no longer exists; "locked" exists but this reader may not create.
    expect(
      await service.recent("u1", mayCreateIn("posts", "pages", "gone"))
    ).toEqual(["posts", "pages"]);
  });

  it("are at most three, counted among those the reader may still use", async () => {
    const { service } = serviceWith('["locked","a","b","c","d"]', [
      "locked",
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(await service.recent("u1", mayCreateIn("a", "b", "c", "d"))).toEqual(
      ["a", "b", "c"]
    );
  });

  it("are none for a reader with nothing recorded", async () => {
    const { service } = serviceWith(undefined, ["posts"]);
    expect(await service.recent("u1", mayCreateIn("posts"))).toEqual([]);
  });
});

describe("recording a type", () => {
  it("puts it first and answers the list a read would", async () => {
    const { service, values } = serviceWith('["pages"]', ["posts", "pages"]);
    expect(
      await service.record("u1", "posts", mayCreateIn("posts", "pages"))
    ).toEqual(["posts", "pages"]);
    expect(values.get("u1:new-type")).toBe('["posts","pages"]');
  });

  it("drops a type the reader can no longer use from what it stores", async () => {
    const { service, values } = serviceWith('["locked","pages"]', [
      "posts",
      "locked",
      "pages",
    ]);
    await service.record("u1", "posts", mayCreateIn("posts", "pages"));
    expect(values.get("u1:new-type")).toBe('["posts","pages"]');
  });

  it("keeps a type another record stored while this one was judging", async () => {
    // Both records read ["faq"]; the other wrote ["pages","faq"] first. This
    // one builds on what is stored when it writes, not on what it read.
    const { service, values } = serviceWith(
      '["faq"]',
      ["posts", "pages", "faq"],
      stored => stored.set("u1:new-type", '["pages","faq"]')
    );
    expect(
      await service.record("u1", "posts", mayCreateIn("posts", "pages", "faq"))
    ).toEqual(["posts", "pages", "faq"]);
    expect(values.get("u1:new-type")).toBe('["posts","pages","faq"]');
  });

  it("refuses a collection the reader may not create in, or one that does not exist, and writes nothing", async () => {
    const { service, preferences } = serviceWith('["pages"]', [
      "pages",
      "locked",
    ]);
    for (const slug of ["locked", "gone"]) {
      await expect(
        service.record("u1", slug, mayCreateIn("pages", "gone"))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(preferences.update).not.toHaveBeenCalled();
  });
});
