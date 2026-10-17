/**
 * The stored forms a contentOnly lock lets a document keep, as the field reads
 * them.
 *
 * What matters is that every read this cannot make leaves NO baseline: the
 * engine then measures the document against its starting blocks alone, which
 * refuses everything a stored baseline would and more. A read answered with a
 * guess instead would let a locked change through.
 */
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { storedFormsOf } from "./lock-baselines";

const forest = { formatVersion: 1, kind: "page", nodes: [] };

function writeTo(
  readStored: PluginFieldWrite["readStored"],
  extra: Partial<PluginFieldWrite> = {}
): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored,
    ...extra,
  };
}

describe("storedFormsOf", () => {
  it("reads the live form and the draft", async () => {
    const asked: string[] = [];
    const forms = await storedFormsOf(
      writeTo(async target => {
        asked.push(target.form);
        return { kind: "value", value: forest };
      }),
      "content"
    );
    expect(asked).toEqual(["published", "draft"]);
    expect(forms).toEqual([forest, forest]);
  });

  it("has no baseline where the read is refused, as it is for a localized field", async () => {
    const forms = await storedFormsOf(
      writeTo(async () => {
        throw new Error(
          '"pages.content" cannot be read here: it is localized.'
        );
      }),
      "content"
    );
    expect(forms).toEqual([]);
  });

  it("has none for a single, a create, or a value that is no document", async () => {
    const never: PluginFieldWrite["readStored"] = async () => {
      throw new Error("not asked");
    };
    expect(
      await storedFormsOf(writeTo(never, { kind: "single" }), "content")
    ).toEqual([]);
    expect(
      await storedFormsOf(writeTo(never, { id: undefined }), "content")
    ).toEqual([]);
    expect(
      await storedFormsOf(
        writeTo(async () => ({ kind: "value", value: "not a document" })),
        "content"
      )
    ).toEqual([]);
    expect(await storedFormsOf(undefined, "content")).toEqual([]);
  });
});
