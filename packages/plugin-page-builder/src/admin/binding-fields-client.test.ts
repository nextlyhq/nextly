/**
 * The picker's read is kept a short while per person, page and language, a
 * failed read is not kept, and an unbind is planned for a saved entry or a
 * Single.
 */
import type { BindingFieldSource } from "@nextlyhq/builder/ops";
import { describe, expect, it, vi } from "vitest";

import {
  BINDING_FIELDS_KEPT_MS,
  bindingFieldsReader,
  unbindPlanner,
} from "./binding-fields-client";

const SITE: readonly BindingFieldSource[] = [
  { binding: { source: "site" }, label: "Site", fields: [] },
];
const post = {
  kind: "collection" as const,
  slug: "posts",
  documentId: "p1",
};

describe("the picker's read of the fields", () => {
  it("is asked once while kept, and again once it has aged", async () => {
    let clock = 1_000;
    const ask = vi.fn(async () => SITE);
    const read = bindingFieldsReader(post, "en", "u-keep", ask, () => clock);
    await read();
    clock += BINDING_FIELDS_KEPT_MS - 1;
    await read();
    expect(ask).toHaveBeenCalledTimes(1);
    clock += 1;
    await read();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenLastCalledWith({
      source: { kind: "collection", slug: "posts", id: "p1" },
      locale: "en",
    });
  });

  it("asks again after a failed read", async () => {
    const ask = vi
      .fn<() => Promise<readonly BindingFieldSource[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(SITE);
    const read = bindingFieldsReader(post, "fr", "u-fail", ask, () => 5);
    await expect(read()).rejects.toThrow("offline");
    await expect(read()).resolves.toBe(SITE);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("never hands one person's answer to the next", async () => {
    const ask = vi.fn(async () => SITE);
    await bindingFieldsReader(post, "de", "u-one", ask, () => 9)();
    await bindingFieldsReader(post, "de", "u-two", ask, () => 9)();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("asks without an entry where the document has none of its own", async () => {
    // A component's document: the Singles and the site, no entry.
    const ask = vi.fn(async () => SITE);
    await expect(
      bindingFieldsReader(null, "en", "u-none", ask)()
    ).resolves.toBe(SITE);
    expect(ask).toHaveBeenCalledWith({ locale: "en" });
  });
});

describe("the unbind planner", () => {
  it("is offered for a saved entry and a Single, not an entry never saved", () => {
    expect(unbindPlanner(post, "en")).toBeTypeOf("function");
    expect(unbindPlanner({ kind: "single", slug: "home" }, "en")).toBeTypeOf(
      "function"
    );
    expect(
      unbindPlanner({ kind: "collection", slug: "posts" }, "en")
    ).toBeUndefined();
    expect(unbindPlanner(null, "en")).toBeUndefined();
  });
});
