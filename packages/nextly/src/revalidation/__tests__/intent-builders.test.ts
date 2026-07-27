import { describe, expect, it } from "vitest";

import {
  buildEntryRevalidationIntent,
  buildSingleRevalidationIntent,
  readRevalidateConfig,
  readStringField,
} from "../intent-builders";

describe("buildEntryRevalidationIntent", () => {
  it("returns the derived intent when revalidation is not disabled", () => {
    const intent = buildEntryRevalidationIntent("posts", undefined, {
      id: "1",
      slug: "hello",
    });
    expect(intent?.tags).toEqual([
      "nextly:posts",
      "nextly:posts:id:1",
      "nextly:posts:slug:hello",
    ]);
  });

  it("returns undefined when the collection disables revalidation", () => {
    const intent = buildEntryRevalidationIntent(
      "posts",
      { disable: true },
      { id: "1", slug: "hello" }
    );
    expect(intent).toBeUndefined();
  });

  it("merges configured extra tags", () => {
    const intent = buildEntryRevalidationIntent(
      "posts",
      { tags: ["navigation"] },
      { id: "1" }
    );
    expect(intent?.tags).toContain("navigation");
  });

  it("busts the previous slug on a rename", () => {
    const intent = buildEntryRevalidationIntent("posts", undefined, {
      id: "1",
      slug: "new",
      previousSlug: "old",
    });
    expect(intent?.tags).toContain("nextly:posts:slug:new");
    expect(intent?.tags).toContain("nextly:posts:slug:old");
  });
});

describe("buildSingleRevalidationIntent", () => {
  it("returns the single tag when not disabled", () => {
    expect(buildSingleRevalidationIntent("header", undefined)?.tags).toEqual([
      "nextly:single:header",
    ]);
  });

  it("returns undefined when disabled", () => {
    expect(
      buildSingleRevalidationIntent("header", { disable: true })
    ).toBeUndefined();
  });
});

describe("readRevalidateConfig", () => {
  it("extracts the revalidate config from a metadata object", () => {
    expect(
      readRevalidateConfig({ slug: "posts", revalidate: { disable: true } })
    ).toEqual({ disable: true });
  });

  it("returns undefined when the metadata carries no revalidate config", () => {
    expect(readRevalidateConfig({ slug: "posts" })).toBeUndefined();
    expect(readRevalidateConfig(null)).toBeUndefined();
    expect(readRevalidateConfig("not an object")).toBeUndefined();
  });
});

describe("readStringField", () => {
  it("reads a string field and ignores non-strings and absent docs", () => {
    expect(readStringField({ slug: "a" }, "slug")).toBe("a");
    expect(readStringField({ slug: 42 }, "slug")).toBeUndefined();
    expect(readStringField(undefined, "slug")).toBeUndefined();
  });
});
