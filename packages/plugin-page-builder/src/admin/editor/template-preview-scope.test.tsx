// @vitest-environment jsdom

/**
 * A template's preview with the canvas's reads wired as the editor wires
 * them: the document the canvas's bindings are asked of is composed with the
 * previewed entry (`useDrawnTemplate`), and the strip and the seam name the
 * entry only once that read has answered (`followingCanvas`).
 *
 * The two depend on each other, so the composition must come from the
 * entry's own read: composed from the seam, each answer changed the canvas's
 * ask, which withdrew the entry, which changed the ask back, without end.
 * Here the reads answer at once and the same every time, and the case
 * watches that each is asked once and that the preview settles on the entry
 * in the collection's own words.
 *
 * @module admin/editor/template-preview-scope.test
 */
import {
  ENTRY_CONTENT_TYPE,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  usePreviewedCollection,
  usePreviewedEntry,
  type PreviewedCollection,
  type PreviewedEntry,
} from "@nextlyhq/builder/shell";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useMemo, type JSX } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PreviewEntriesResponse,
  PreviewEntryResponse,
} from "../../templates/template-preview-contract";

import type { TemplatePreview } from "./use-template-preview";

const listPreviewEntries = vi.hoisted(() => vi.fn());
const readPreviewEntry = vi.hoisted(() => vi.fn());
vi.mock("../template-preview-client", () => ({
  listPreviewEntries,
  readPreviewEntry,
}));

// The canvas's bindings read, through the plugin route writer.
const writePluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => "u1",
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "templates",
    documentId: "t1",
  }),
  useDocumentLocale: () => null,
  useWidgetClock: () => Date.parse("2026-11-08T10:00:00.000Z"),
  formatWidgetTime: (iso: string) => `at ${iso.slice(0, 10)}`,
  // Words no collection label is, so a label taken from the field's name
  // rather than the collection's answer is told apart.
  humanizeFieldName: (name: string) => `field ${name}`,
  writePluginRoute,
  // The admin's preference store, as the tab's session storage the preview
  // memory is kept in: its own rules are the admin's to test.
  devicePreferenceStore: (key: string) => ({
    read: () => window.sessionStorage.getItem(key),
    write: (value: string) => window.sessionStorage.setItem(key, value),
    remove: () => window.sessionStorage.removeItem(key),
  }),
  PILL_LABEL: {
    draft: "Draft",
    modified: "Modified",
    changed: "Changed",
    published: "Published",
  },
}));

const { TemplatePreviewScope, useDrawnTemplate, useTemplatePreviewState } =
  await import("./template-preview-strip");
const { useCanvasBindings } = await import("../canvas-bindings-client");

const ARTICLE_TITLE = "Building a content model that lasts";

/** The template: an Entry content block drawing the article's Body, alone. */
const TEMPLATE: BlockDocument = {
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

/** The article's Body: a heading bound to its slug, read once composed in. */
const BODY: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "b0",
      type: "core/heading",
      version: 1,
      props: { text: "Body heading fallback", level: "h3" },
      bindings: { text: { $bind: "slug" } },
    },
  ],
};

const LISTED: PreviewEntriesResponse = {
  items: [
    {
      id: "a1",
      title: ARTICLE_TITLE,
      status: "published",
      updatedAt: "2026-11-07T21:27:30.000Z",
    },
  ],
  meta: {
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
    mayCreate: true,
    labels: { singular: "Article", plural: "Articles" },
    blocksFields: [{ name: "body", label: "Body" }],
  },
};

const ENTRY: PreviewEntryResponse = {
  id: "a1",
  title: ARTICLE_TITLE,
  status: "published",
  editorValues: { id: "a1", slug: "a-content-model", body: BODY },
  publicValues: { id: "a1", slug: "a-content-model", body: BODY },
  fields: [],
};

/** What the canvas's sources answer, the same on every ask. */
const BINDINGS = {
  entry: { id: "a1", slug: "a-content-model" },
  entryRef: { collection: "entry-articles" },
  singles: [],
  shapes: [],
};

/** What the editor's parts read of the preview, at their latest render. */
const seen: {
  renders: number;
  preview: TemplatePreview | undefined;
  previewed: PreviewedEntry | undefined;
  collection: PreviewedCollection | undefined;
} = {
  renders: 0,
  preview: undefined,
  previewed: undefined,
  collection: undefined,
};

/**
 * The canvas's side of the editor, as `BlocksEditor` wires it: its bindings
 * asked of the template as drawn, and the seam read beside them.
 */
function Canvas(): null {
  const drawn = useDrawnTemplate(TEMPLATE);
  const trees = useMemo(() => [drawn], [drawn]);
  useCanvasBindings(trees, undefined);
  seen.renders += 1;
  seen.preview = useTemplatePreviewState();
  seen.previewed = usePreviewedEntry();
  seen.collection = usePreviewedCollection();
  return null;
}

/** A template's form naming the articles collection, around its editor. */
function Editor(): JSX.Element {
  const { control } = useForm({
    defaultValues: { collection: "entry-articles" },
  });
  return (
    <TemplatePreviewScope control={control}>
      <Canvas />
    </TemplatePreviewScope>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  seen.renders = 0;
  seen.preview = undefined;
  seen.previewed = undefined;
  seen.collection = undefined;
  listPreviewEntries.mockReset();
  readPreviewEntry.mockReset();
  writePluginRoute.mockReset();
  listPreviewEntries.mockResolvedValue(LISTED);
  readPreviewEntry.mockResolvedValue(ENTRY);
  writePluginRoute.mockResolvedValue(BINDINGS);
});

afterEach(cleanup);

describe("a template holding Entry content, previewed with an entry", () => {
  it("reads each route once and settles on the entry, in the collection's words", async () => {
    render(<Editor />);
    await waitFor(() =>
      expect(seen.previewed).toMatchObject({ kind: "entry", id: "a1" })
    );

    // A few more ticks of the clock: an ask that changes with its own
    // answer goes on rendering and asking through them.
    const settled = seen.renders;
    for (let tick = 0; tick < 5; tick += 1) {
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    }
    expect(seen.renders).toBe(settled);
    expect(seen.previewed).toMatchObject({ kind: "entry", id: "a1" });

    expect(listPreviewEntries).toHaveBeenCalledTimes(1);
    expect(readPreviewEntry).toHaveBeenCalledTimes(1);
    // The canvas's sources, asked once, of the template with the article's
    // Body composed in: the slug its heading binds.
    expect(writePluginRoute).toHaveBeenCalledTimes(1);
    expect(writePluginRoute.mock.calls[0]?.[0]).toMatchObject({
      body: { demand: { entry: { fields: ["slug"] } } },
    });

    expect(seen.preview?.chip).toMatchObject({
      id: "a1",
      title: ARTICLE_TITLE,
      loading: false,
      unavailable: false,
    });
    // The collection's own words, from the list's answer, not its slug's.
    expect(seen.collection?.singular).toBe("article");
    expect(seen.collection?.plural).toBe("Articles");
    expect(seen.collection?.fieldLabel("body")).toBe("Body");
  });
});
