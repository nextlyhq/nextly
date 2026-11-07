// @vitest-environment jsdom

/**
 * The page the editor's canvas draws, and the entry its conditions are
 * judged with, while the strip names no entry yet: a REFRESH of the entry it
 * named keeps that entry's blocks and its subject (`latest`), so nothing
 * drops out or shows that its conditions hide; a SWITCH to another entry, or
 * a read that failed, draws none of the entry until both reads have answered.
 *
 * @module admin/editor/conditioned-page.test
 */
import {
  ENTRY_CONTENT_SLOT,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  useAppliedConditions,
  type PreviewedEntry,
} from "@nextlyhq/builder/shell";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useConditionedPage } from "./conditioned-page";
import type { PreviewChip, TemplatePreview } from "./use-template-preview";

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
  // A visitor reads it as a free article, so the VIP block is hidden.
  publicValues: { tier: "free" },
  fields: [{ name: "tier", type: "text" }],
};

/** Another article, its Body holding a block of its own. */
const OTHER: PreviewedEntry = {
  ...ARTICLE,
  id: "a2",
  title: "Writing alt text that helps",
};

const LOADING: PreviewedEntry = { kind: "none", reason: "loading" };

/** The chip naming `entry`, read or not. */
function chipOf(entry: PreviewedEntry, unavailable = false): PreviewChip {
  return {
    id: entry.kind === "entry" ? entry.id : "",
    title: entry.kind === "entry" ? entry.title : "",
    status: "published",
    unavailable,
    loading: !unavailable,
  };
}

/** A preview naming `previewed` while its latest read is `latest`. */
function previewOf(
  previewed: PreviewedEntry,
  latest: PreviewedEntry,
  chip: PreviewChip | undefined = undefined
): TemplatePreview {
  return {
    collection: "articles",
    fixed: false,
    labels: { singular: "Article", plural: "Articles" },
    blocksFields: [{ name: "body", label: "Body" }],
    language: undefined,
    list: { state: "ready", items: [], mayCreate: false },
    chip,
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

/**
 * The page and its conditions applied for the settled entry, as the editor
 * draws them, over a preview that changes from render to render.
 */
function drawnOver(first: TemplatePreview) {
  return renderHook(
    ({ preview }: { preview: TemplatePreview }) => {
      const page = useConditionedPage(TEMPLATE, preview, undefined);
      const applied = useAppliedConditions(page.composed, page.entry, {
        noun: "article",
      });
      return { page, applied };
    },
    { initialProps: { preview: first } }
  );
}

/** The article named, both its reads answered. */
const NAMED = previewOf(ARTICLE, ARTICLE, {
  ...chipOf(ARTICLE),
  loading: false,
});

describe("the page the canvas draws while the strip names no entry yet", () => {
  it("keeps the entry's Body, and its conditioned block, through a refresh of that entry", () => {
    const { result, rerender } = drawnOver(NAMED);
    expect(drawnIn(result.current.page.composed)).toBe(1);
    // The window's refresh: the same entry, read again, named by no one yet.
    rerender({ preview: previewOf(LOADING, ARTICLE, chipOf(ARTICLE)) });
    expect(drawnIn(result.current.page.composed)).toBe(1);
    expect(result.current.page.held).toEqual({
      any: true,
      readingEntry: true,
    });
  });

  it("draws none of a newly chosen entry while its canvas read is on its way", () => {
    const { result, rerender } = drawnOver(NAMED);
    // The new entry's own read has answered; the canvas's has not.
    rerender({ preview: previewOf(LOADING, OTHER, chipOf(OTHER)) });
    expect(result.current.page.composed).toBe(TEMPLATE);
  });

  it("draws no Body for an entry whose canvas read failed", () => {
    const { result, rerender } = drawnOver(NAMED);
    rerender({
      preview: previewOf(
        { kind: "none", reason: "unavailable" },
        ARTICLE,
        chipOf(ARTICLE, true)
      ),
    });
    expect(result.current.page.composed).toBe(TEMPLATE);
  });

  it("is the bare template where no entry was ever named (the control)", () => {
    const { result } = drawnOver(previewOf(LOADING, LOADING));
    expect(result.current.page.composed).toBe(TEMPLATE);
    expect(result.current.page.held).toEqual({
      any: false,
      readingEntry: false,
    });
  });
});

describe("conditions applied through a refresh of the same entry", () => {
  it("keeps a block they hide hidden while the entry is read again", () => {
    const { result, rerender } = drawnOver(NAMED);
    // The control: named, the VIP block is hidden for a free article.
    expect(result.current.applied?.hidden).toHaveLength(1);
    rerender({ preview: previewOf(LOADING, ARTICLE, chipOf(ARTICLE)) });
    expect(result.current.applied?.hidden).toHaveLength(1);
  });
});

describe("a refresh whose entry read answers before the canvas's", () => {
  // The same article, its Body revised in another tab: one plain block.
  const REVISED: PreviewedEntry = {
    ...ARTICLE,
    editorValues: {
      body: {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "rev",
            type: "core/text",
            version: 1,
            props: { text: "Revised paragraph" },
          },
        ],
      },
    },
  };

  /** What the Entry content block draws, by its blocks' words. */
  function wordsIn(page: BlockDocument): unknown[] {
    return (page.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT] ?? []).map(
      node => node.props.text
    );
  }

  it("keeps the Body and conditions as named until the strip names the refreshed entry", () => {
    const { result, rerender } = drawnOver(NAMED);
    // The entry's own read has answered with the revision; the canvas's
    // read of it is still on its way, so the strip names no entry yet.
    rerender({ preview: previewOf(LOADING, REVISED, chipOf(REVISED)) });
    expect(wordsIn(result.current.page.composed)).toEqual([
      "Members' worksheet",
    ]);
    expect(result.current.applied?.hidden).toHaveLength(1);
    // Both reads back: the strip names the revision, and it is drawn.
    rerender({
      preview: previewOf(REVISED, REVISED, {
        ...chipOf(REVISED),
        loading: false,
      }),
    });
    expect(wordsIn(result.current.page.composed)).toEqual([
      "Revised paragraph",
    ]);
    expect(result.current.applied?.hidden).toEqual([]);
  });
});
