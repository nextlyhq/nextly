// @vitest-environment jsdom

/**
 * How the canvas draws a template's Entry content block: the previewed
 * entry's own blocks (its values as the person editing reads them), or the
 * note that says why there are none, in the words the design fixed.
 *
 * The drawn document is asserted beside the stored one, which must never
 * gain the entry's blocks, and outside a template the canvas draws exactly
 * what it was given, by identity.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import {
  useComposedEntryContent,
  useEntryContentDrawing,
} from "./entry-content-canvas";
import {
  PreviewedEntryProvider,
  type PreviewedCollection,
  type PreviewedEntry,
} from "./previewed-entry";

const template: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    {
      id: "ec",
      type: ENTRY_CONTENT_TYPE,
      version: 1,
      props: { field: "body" },
    },
  ],
};

const body: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    { id: "p1", type: "core/text", version: 1, props: { text: "Hello" } },
  ],
};

const POSTS: PreviewedCollection = {
  slug: "posts",
  singular: "post",
  plural: "Posts",
  blocksFields: [
    { name: "body", label: "Body" },
    { name: "sidebar", label: "Sidebar" },
  ],
  // Its label where it has one, else the host's words for a key: here a
  // stand-in that says which it took.
  fieldLabel: name =>
    (({ body: "Body", sidebar: "Sidebar" }) as Record<string, string>)[name] ??
    `Words for ${name}`,
  entryHref: id => `/admin/collections/posts/${id}`,
};

function entry(editorValues: Record<string, unknown>): PreviewedEntry {
  return {
    kind: "entry",
    collection: "posts",
    id: "p1",
    title: "Writing alt text that helps",
    editorValues,
    publicValues: null,
    fields: [],
  };
}

function drawing(
  previewed: PreviewedEntry,
  collection: PreviewedCollection | undefined = POSTS,
  document: BlockDocument = template
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PreviewedEntryProvider value={previewed} collection={collection}>
      {children}
    </PreviewedEntryProvider>
  );
  return renderHook(() => useEntryContentDrawing(document, undefined), {
    wrapper,
  }).result.current;
}

/** The note the drawn block says for the field it names. */
function noteOf(
  previewed: PreviewedEntry,
  collection: PreviewedCollection | undefined = POSTS,
  field: string | undefined = "body"
) {
  const canvas = drawing(previewed, collection).render?.context
    ?.entryContentCanvas;
  if (canvas === undefined) throw new Error("no canvas member");
  return canvas.noteFor(field);
}

describe("the previewed entry's own content on the canvas", () => {
  it("draws the entry's editor values for the field, drafts included, and stores nothing", () => {
    const drawn = drawing(entry({ body }));
    expect(
      drawn.document.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(node => node.id)
    ).toEqual(["ec:p1"]);
    // The document the editor holds is the template as stored.
    expect(template.nodes[0]?.slots).toBeUndefined();
    expect(drawn.render?.context?.entryContentCanvas).toBeDefined();
  });

  it("draws nothing of the entry's for a field it does not hold", () => {
    const drawn = drawing(entry({ sidebar: body }));
    expect(drawn.document).toBe(template);
  });

  it("changes nothing outside a template, where nothing is previewed", () => {
    const { result } = renderHook(() =>
      useEntryContentDrawing(template, undefined)
    );
    expect(result.current.document).toBe(template);
    expect(result.current.render).toBeUndefined();
  });
});

describe("the composed template a host asks its sources of", () => {
  const wrapper =
    (previewed: PreviewedEntry) =>
    ({ children }: { children: ReactNode }) => (
      <PreviewedEntryProvider value={previewed} collection={POSTS}>
        {children}
      </PreviewedEntryProvider>
    );

  it("is the one the canvas draws: the previewed entry's blocks composed in", () => {
    const previewed = entry({ body });
    const composed = renderHook(() => useComposedEntryContent(template), {
      wrapper: wrapper(previewed),
    }).result.current;
    const drawn = renderHook(
      () => useEntryContentDrawing(template, undefined),
      { wrapper: wrapper(previewed) }
    ).result.current.document;
    expect(composed).toEqual(drawn);
    expect(
      composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(node => node.id)
    ).toEqual(["ec:p1"]);
  });

  it("is the template itself while no entry is previewed (the control)", () => {
    const composed = renderHook(() => useComposedEntryContent(template), {
      wrapper: wrapper({ kind: "none", reason: "empty" }),
    }).result.current;
    expect(composed).toBe(template);
  });
});

describe("the canvas's notes in Entry content's place", () => {
  it("says what shows there while no entry is previewed", () => {
    expect(noteOf({ kind: "none", reason: "empty" })).toEqual({
      tone: "muted",
      words: "The post’s Body shows here.",
    });
  });

  it("names the entry whose field is empty", () => {
    expect(noteOf(entry({}))).toEqual({
      tone: "muted",
      lead: "Writing alt text that helps",
      words: "has no Body content yet.",
    });
  });

  it("says in red that a field the collection no longer has shows nothing", () => {
    const withoutBody: PreviewedCollection = {
      ...POSTS,
      blocksFields: [{ name: "sidebar", label: "Sidebar" }],
    };
    expect(noteOf(entry({ body }), withoutBody)).toEqual({
      tone: "failed",
      words:
        "The Body field no longer exists in Posts, so this shows nothing. Choose another field.",
    });
  });

  it("never calls a field removed while the collection's fields are not known (the control)", () => {
    const unknown: PreviewedCollection = { ...POSTS, blocksFields: undefined };
    expect(noteOf(entry({}), unknown).tone).toBe("muted");
  });
});
