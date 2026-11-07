// @vitest-environment jsdom

/**
 * The page the editor's canvas draws, and its conditioned blocks, while the
 * window's refresh reads the previewed entry again: the seam names no entry
 * until that read is back (`previewed` loading), and the page keeps the
 * entry's blocks as last read (`latest`), so the Body and the conditions it
 * holds stay drawn and counted rather than dropping out mid-refresh.
 *
 * @module admin/editor/conditioned-page.test
 */
import {
  ENTRY_CONTENT_SLOT,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { PreviewedEntry } from "@nextlyhq/builder/shell";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useConditionedPage } from "./conditioned-page";
import type { TemplatePreview } from "./use-template-preview";

/** The articles template: Entry content drawing Body, unconditioned. */
const TEMPLATE: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "ec",
      type: "core/entry-content",
      version: 1,
      props: { field: "body" },
    },
  ],
};

/** The article as last read: its Body holds a block for VIP articles. */
const ARTICLE: PreviewedEntry = {
  kind: "entry",
  collection: "articles",
  id: "a1",
  title: "Building a content model",
  editorValues: {
    body: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "vip",
          type: "core/text",
          version: 1,
          props: { text: "Members' worksheet" },
          visibility: {
            conditions: [[{ field: "tier", op: "equals", value: "vip" }]],
          },
        },
      ],
    },
  },
  publicValues: null,
  fields: [],
};

/** A preview naming `previewed` while its latest read is `latest`. */
function previewOf(
  previewed: PreviewedEntry,
  latest: PreviewedEntry
): TemplatePreview {
  return {
    collection: "articles",
    fixed: false,
    labels: { singular: "Article", plural: "Articles" },
    blocksFields: [{ name: "body", label: "Body" }],
    language: undefined,
    list: { state: "ready", items: [], mayCreate: false },
    chip: undefined,
    previewed,
    latest,
    choose: vi.fn(),
    step: vi.fn(() => undefined),
    refresh: vi.fn(),
  };
}

/** How many of the entry's blocks the template's Entry content draws. */
function drawnIn(page: BlockDocument): number {
  return page.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.length ?? 0;
}

describe("the page the canvas draws while the entry is read again", () => {
  it("keeps the entry's Body, and its conditioned block, from the latest read", () => {
    // Mid-refresh: the seam names no entry, the latest read still holds it.
    const { result } = renderHook(() =>
      useConditionedPage(
        TEMPLATE,
        previewOf({ kind: "none", reason: "loading" }, ARTICLE),
        undefined
      )
    );
    expect(drawnIn(result.current.composed)).toBe(1);
    expect(result.current.held).toEqual({ any: true, readingEntry: true });
  });

  it("is the bare template where no entry was ever read (the control)", () => {
    const loading: PreviewedEntry = { kind: "none", reason: "loading" };
    const { result } = renderHook(() =>
      useConditionedPage(TEMPLATE, previewOf(loading, loading), undefined)
    );
    expect(result.current.composed).toBe(TEMPLATE);
    expect(result.current.held).toEqual({ any: false, readingEntry: false });
  });
});
