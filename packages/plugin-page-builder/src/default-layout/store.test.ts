/**
 * The store's Layout lookups ask only for ids.
 *
 * Each answers "which of these exist" or "which are published", and only the
 * id is read from the rows. A read that fetched whole rows would pass every
 * behavioural test while loading each Layout's areas, so the request itself is
 * what is asserted: a recording fake keeps every `find` it is asked.
 */
import { describe, expect, it } from "vitest";

import {
  changedByOf,
  layoutExists,
  publishedLayoutIds,
  readLayoutSettings,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./store";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

/** A Direct API that answers every `find` with `rows` and records the asks. */
function recording(rows: { id: string }[]) {
  const asked: Record<string, unknown>[] = [];
  const nextly = {
    find: async (args: Record<string, unknown>) => {
      asked.push(args);
      return { items: rows, meta: { hasNext: false } };
    },
  } as unknown as Pick<DefaultLayoutDirectApi, "find">;
  return { nextly, asked };
}

describe("the store's Layout lookups", () => {
  it("asks only for ids when answering which Layouts are published", async () => {
    const { nextly, asked } = recording([{ id: "a" }]);

    const published = await publishedLayoutIds(nextly, SLUGS, ["a", "b"]);

    expect([...published]).toEqual(["a"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      status: "published",
      select: { id: true },
    });
  });

  it("asks only for ids when answering whether a Layout exists", async () => {
    const { nextly, asked } = recording([{ id: "a" }]);

    expect(await layoutExists(nextly, SLUGS, "a")).toBe(true);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ status: "all", select: { id: true } });
  });
});

describe("writing the settings from a read of them", () => {
  // A write decided on a read sends that read's version, so a default chosen
  // by someone else in between refuses it instead of being overwritten.
  function settingsApi(stored: Record<string, unknown> | null) {
    const written: Record<string, unknown>[] = [];
    const nextly = {
      findSingle: async () => stored,
      updateSingle: async ({ data }: { data: Record<string, unknown> }) => {
        written.push(data);
        return { item: data };
      },
    } as unknown as Pick<DefaultLayoutDirectApi, "findSingle" | "updateSingle">;
    return { nextly, written };
  }

  it("sends the version the settings were read at", async () => {
    const { nextly, written } = settingsApi({ defaultLayout: "a", _rev: "4" });
    const read = await readLayoutSettings(nextly, SLUGS);
    expect(read.rev).toBe("4");

    await writeLayoutSettings(nextly, SLUGS, read, { defaultLayout: "b" });

    expect(written).toEqual([{ defaultLayout: "b", _rev: "4" }]);
  });

  it("sets settings never stored whatever is there, since there is nothing to be out of date with", async () => {
    const { nextly, written } = settingsApi(null);
    const read = await readLayoutSettings(nextly, SLUGS);
    expect(read.rev).toBeUndefined();

    await writeLayoutSettings(nextly, SLUGS, read, { defaultLayout: "b" });

    expect(written).toEqual([{ defaultLayout: "b", _overwrite: true }]);
  });

  // A write decided on no read of the settings, such as choosing a default,
  // sets its values over whatever they hold, version or not.
  it("sets the values whatever the settings hold when the write says so", async () => {
    const { nextly, written } = settingsApi({ defaultLayout: "a", _rev: "4" });

    await writeLayoutSettings(nextly, SLUGS, "overwrite", {
      defaultLayout: "b",
    });

    expect(written).toEqual([{ defaultLayout: "b", _overwrite: true }]);
  });
});

describe("who chose the default, as the settings record it", () => {
  it("names an API key as the key, and a person as the person", () => {
    expect(
      changedByOf({ kind: "api-key", userId: "owner-1", apiKeyId: "key-1" })
    ).toBe("api-key:key-1");
    expect(changedByOf({ kind: "user", userId: "person-1" })).toBe(
      "user:person-1"
    );
  });
});
