import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { TransferFile } from "./transfer-contract";
import { readTransferFile } from "./transfer-file-schema";

const BYTES = Buffer.from("a dot");

function media(id: string, bytes: Buffer = BYTES) {
  return {
    id,
    filename: "dot.png",
    mimeType: "image/png",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    data: bytes.toString("base64"),
  };
}

function file(overrides: Partial<TransferFile> = {}): TransferFile {
  return {
    format: "nextly-page-builder-transfer",
    formatVersion: 1,
    exportedAt: "2026-11-03T00:00:00.000Z",
    root: { kind: "component", id: "a" },
    components: [
      {
        id: "a",
        title: "A",
        slug: "a",
        status: "published",
        content: { formatVersion: 1, kind: "component", nodes: [] },
      },
    ],
    patterns: [],
    layouts: [],
    classes: [],
    tokens: [],
    breakpoints: [],
    media: [media("m")],
    blockTypes: [],
    ...overrides,
  };
}

function messages(raw: unknown): string[] {
  const read = readTransferFile(raw);
  return "issues" in read ? read.issues.map(issue => issue.message) : [];
}

describe("readTransferFile", () => {
  it("leaves out a block's own look, so an import never changes the site's", () => {
    const primary = {
      id: "look:core/button:primary",
      slug: "button-primary",
      orderIndex: 0,
      blockType: "core/button",
      isDefault: true,
      styles: { base: { base: { color: "purple" } } },
    };
    const outline = {
      id: "look:core/button:outline",
      slug: "button-outline",
      orderIndex: 1,
      blockType: "core/button",
      styles: { base: { base: { color: "red" } } },
    };
    const read = readTransferFile(file({ classes: [primary, outline] }));
    if (!("file" in read)) throw new Error("refused");
    // The population: a look blocks wear is carried.
    expect(read.file.classes.map(entry => entry.id)).toEqual([outline.id]);
  });

  it("accepts a whole file", () => {
    expect(messages(file())).toEqual([]);
  });

  it("accepts a description as long as the collections store", () => {
    const long = "x".repeat(20_000);
    const base = file();
    expect(
      messages({
        ...base,
        components: base.components.map(item => ({
          ...item,
          description: long,
        })),
      })
    ).toEqual([]);
  });

  it("refuses another format, a missing root and damaged media", () => {
    expect(messages({ ...file(), format: "something-else" })).not.toEqual([]);
    expect(messages(file({ root: { kind: "pattern", id: "a" } }))).toEqual([
      "The file does not carry the item it was made from.",
    ]);
    const damaged = {
      ...media("m"),
      data: Buffer.from("another").toString("base64"),
    };
    expect(messages(file({ media: [damaged] }))).toEqual([
      'The media file "dot.png" is damaged: its bytes do not match the size and digest the file states.',
    ]);
  });

  it("refuses an id listed twice in any one list", () => {
    expect(messages(file({ media: [media("m"), media("m")] }))).toEqual([
      'The file lists "m" twice among its media.',
    ]);
    expect(
      messages(
        file({
          breakpoints: [
            { id: "b", label: "B", axis: "viewport", maxWidth: 400 },
            { id: "b", label: "B", axis: "container", maxWidth: 300 },
          ],
        })
      )
    ).toEqual(['The file lists "b" twice among its breakpoints.']);
  });
});
