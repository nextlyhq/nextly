/**
 * The stored forms a contentOnly lock lets a document keep, as the field reads
 * them.
 *
 * What matters is that every read this cannot make leaves NO baseline: the
 * engine then measures the document against its starting blocks alone, which
 * refuses everything a stored baseline would and more. A read answered with a
 * guess instead would let a locked change through.
 */
import { NextlyError, type PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";

import {
  composedFormsRead,
  readStoredForms,
  storedFormsOf,
} from "./lock-baselines";

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

  it("reads a single by its slug, and the language the write is judged in", async () => {
    const asked: unknown[] = [];
    const read: PluginFieldWrite["readStored"] = async target => {
      asked.push(target);
      return { kind: "value", value: forest };
    };

    await storedFormsOf(
      writeTo(read, { kind: "single", slug: "home", id: undefined }),
      "content"
    );
    await storedFormsOf(writeTo(read, { locale: "de" }), "content");

    expect(asked).toEqual([
      { single: "home", field: "content", form: "published" },
      { single: "home", field: "content", form: "draft" },
      {
        collection: "pages",
        id: "p1",
        field: "content",
        form: "published",
        locale: "de",
      },
      {
        collection: "pages",
        id: "p1",
        field: "content",
        form: "draft",
        locale: "de",
      },
    ]);
  });

  it("has no baseline where the read is refused", async () => {
    const forms = await storedFormsOf(
      writeTo(async () => {
        throw new Error(
          '"pages.content" cannot be read here: that store is not ready.'
        );
      }),
      "content"
    );
    expect(forms).toEqual([]);
  });

  it("has none for a create, a language that stores nothing, or a value that is no document", async () => {
    const never: PluginFieldWrite["readStored"] = async () => {
      throw new Error("not asked");
    };
    expect(
      await storedFormsOf(
        writeTo(async () => ({ kind: "absent" }), { locale: "fr" }),
        "content"
      )
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

describe("readStoredForms on a translated field", () => {
  const localizedWrite = (fails: unknown): PluginFieldWrite => ({
    kind: "collection",
    slug: "pages",
    id: "p1",
    locale: "de",
    inTransaction: false,
    readStored: async () => {
      throw fails;
    },
  });

  it("is unreadable only while the language's store is not ready", async () => {
    await expect(
      readStoredForms(
        localizedWrite(NextlyError.serviceUnavailable()),
        "content",
        [false, true],
        true
      )
    ).resolves.toEqual({ forms: [], readable: false });
  });

  it("lets any other failure through, rather than waving the write past the rule", async () => {
    // A query failure is not a reason to treat a stored page as unjudgeable.
    await expect(
      readStoredForms(
        localizedWrite(new Error("connection reset")),
        "content",
        [false, true],
        true
      )
    ).rejects.toThrow("connection reset");
  });
});

describe("composedFormsRead", () => {
  it("says a baseline is incomplete when the allowance ran out before a host", async () => {
    const result = await composedFormsRead({
      hosts: [forest as never],
      library: { held: new Map(), missing: new Set() },
      read: { exhausted: () => false } as never,
      limits: DEFAULT_LIMITS,
      work: { left: 0 },
    });
    expect(result).toEqual({ forms: [], complete: false });
  });
});
