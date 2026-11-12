/**
 * Whether the open editor holds work the form cannot see.
 *
 * An inspector field holding a passage open in the shared rich-text editor is
 * such work, as an open passage on the canvas is: its words are in that
 * editor alone until it is finished, so Save must be offered for it.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@nextlyhq/blocks-engine";

import {
  documentToHandOver,
  documentToStore,
  hasUnsavedWork,
} from "./use-host-commit";

const clean = { editing: null, editingRich: null };

describe("hasUnsavedWork", () => {
  it("counts a passage open in an inspector field", () => {
    expect(
      hasUnsavedWork({ undoDepth: 0 }, { ...clean, inspecting: true })
    ).toBe(true);
  });

  it("is clean with nothing open and nothing since the save point", () => {
    // The control: the new term does not make every editor dirty.
    expect(
      hasUnsavedWork({ undoDepth: 0 }, { ...clean, inspecting: false })
    ).toBe(false);
    expect(hasUnsavedWork({ undoDepth: 0 }, clean)).toBe(false);
  });
});

describe("documentToStore", () => {
  const held = { formatVersion: 1, kind: "template", nodes: [] } as never;
  const made = {
    formatVersion: 1,
    kind: "template",
    nodes: [],
    settings: { seo: { title: ["Held"] } },
  } as unknown as BlockDocument;
  const nothingOpen = { commit: () => ({ status: "unchanged" }) as const };

  it("is the document an edit a Settings tab held made, before the store", () => {
    expect(documentToStore(nothingOpen, held, () => made)).toBe(made);
  });

  it("is the document as held where no tab holds an edit", () => {
    expect(documentToStore(nothingOpen, held, () => null)).toBe(held);
    expect(documentToStore(nothingOpen, held, undefined)).toBe(held);
  });
});

describe("documentToHandOver", () => {
  const document = { formatVersion: 1, kind: "template", nodes: [] } as never;
  const made = {
    formatVersion: 1,
    kind: "template",
    nodes: [],
    settings: { seo: { title: ["Held"] } },
  } as unknown as BlockDocument;
  const clean = {
    commit: () => ({ status: "unchanged" }) as const,
    editing: null,
    editingRich: null,
  };

  it("is the document an edit a Settings tab held made, though nothing else is unsaved", () => {
    expect(
      documentToHandOver({ undoDepth: 0, document }, clean, 0, () => made)
    ).toBe(made);
  });

  it("is nothing with no held edit and nothing unsaved, and the document with unsaved work", () => {
    expect(
      documentToHandOver({ undoDepth: 0, document }, clean, 0, () => null)
    ).toBeNull();
    expect(
      documentToHandOver({ undoDepth: 1, document }, clean, 0, undefined)
    ).toBe(document);
  });
});
