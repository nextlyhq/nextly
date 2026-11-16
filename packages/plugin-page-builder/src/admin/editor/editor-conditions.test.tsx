// @vitest-environment jsdom
/**
 * "Preview as visitor" as the editor keeps it: available where there is a
 * conditioned block and an entry to check it against, applied only while it
 * is on and can be, and the strip above the canvas that says so while it is,
 * under a template's Previewing row or alone.
 *
 * @module admin/editor/editor-conditions.test
 */
import type {
  AppliedConditions,
  PreviewedEntry,
} from "@nextlyhq/builder/shell";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What each apply was handed: the entry, or undefined while not applied. */
const appliedWith = vi.fn();
vi.mock("@nextlyhq/builder/shell", () => ({
  useAppliedConditions: (_document: unknown, entry: unknown) => {
    appliedWith(entry);
    return entry === undefined ? undefined : HIDING_ONE;
  },
}));

/** Whether the page was asked to be read as a visitor reads it. */
const pageWanted = vi.fn();
vi.mock("./page-conditions-read", () => ({
  usePageConditionsRead: (_source: unknown, wanted: boolean) => {
    pageWanted(wanted);
    return {
      previewed: wanted ? ENTRY : undefined,
      noun: "page",
      failed: false,
    };
  },
}));

vi.mock("./template-preview-strip", () => ({
  TemplatePreviewStrip: ({ visitor }: { visitor?: React.ReactNode }) => (
    <div data-testid="previewing">
      Previewing
      {visitor}
    </div>
  ),
}));

vi.mock("../loop-collections-client", () => ({
  loopCollectionsIn: () => () => Promise.resolve([]),
}));

const HIDING_ONE: AppliedConditions = {
  document: { formatVersion: 1, kind: "page", nodes: [] },
  unjudged: false,
  byEntry: false,
  shown: new Set(),
  hidden: [{ id: "a", name: "Pack", reason: "", unchecked: false }],
};

const ENTRY: PreviewedEntry = {
  kind: "entry",
  collection: "posts",
  id: "p1",
  title: "Hello",
  publicValues: {},
  editorValues: {},
  fields: [],
};

const { editorStrip, useAppliedConditionsSwitch } = await import(
  "./editor-conditions"
);
type Preview = Parameters<typeof editorStrip>[0];

afterEach(() => {
  cleanup();
  appliedWith.mockClear();
  pageWanted.mockClear();
});

const COMPOSED = { formatVersion: 1, kind: "page", nodes: [] } as const;
const CONDITIONED = { any: true, readingEntry: true, readingItems: false };
const PLAIN = { any: false, readingEntry: false, readingItems: false };
const PAGE = { collection: "pages", id: "pg1", locale: undefined };
const TEMPLATE = { labels: { singular: "Post" } } as unknown as Preview;

function useSwitch({
  held = CONDITIONED,
  preview,
  kind = "page",
  source,
  entry,
}: {
  held?: typeof CONDITIONED;
  preview?: Preview;
  kind?: "page" | "template" | "component";
  source?: typeof PAGE;
  entry?: PreviewedEntry;
}) {
  return useAppliedConditionsSwitch(
    { entry, composed: COMPOSED, held },
    preview,
    kind,
    source,
    {}
  );
}

describe("Preview as visitor on a page", () => {
  it("is off until turned on, then applies the page as a visitor reads it, and stops", () => {
    const { result } = renderHook(() => useSwitch({ source: PAGE }));
    expect(result.current.visitor.on).toBe(false);
    expect(result.current.visitor.unavailable).toBeUndefined();
    expect(result.current.said).toBeUndefined();
    expect(appliedWith).toHaveBeenLastCalledWith(undefined);

    act(() => result.current.visitor.onChange(true));
    expect(result.current.visitor.on).toBe(true);
    expect(pageWanted).toHaveBeenLastCalledWith(true);
    expect(appliedWith).toHaveBeenLastCalledWith(ENTRY);
    expect(result.current.said).toBe("1 block hidden for this page");

    // The strip's Stop turns it off, and the canvas shows every block again.
    render(<>{editorStrip(undefined, result.current)}</>);
    act(() => screen.getByRole("button", { name: "Stop" }).click());
    expect(result.current.visitor.on).toBe(false);
    expect(result.current.said).toBeUndefined();
    expect(appliedWith).toHaveBeenLastCalledWith(undefined);
  });

  it("is unavailable and applies nothing where no block has conditions", () => {
    const { result } = renderHook(() =>
      useSwitch({ source: PAGE, held: PLAIN })
    );
    expect(result.current.visitor.unavailable).toBe(
      "No block on this page has conditions"
    );
    act(() => result.current.visitor.onChange(true));
    expect(result.current.visitor.on).toBe(false);
    expect(pageWanted).not.toHaveBeenCalledWith(true);
    expect(appliedWith).toHaveBeenLastCalledWith(undefined);
  });

  it("needs an entry on a page that is none of a collection's", () => {
    // A Single: its conditions have nothing to be checked against here.
    const { result } = renderHook(() => useSwitch({}));
    expect(result.current.visitor.unavailable).toBe(
      "Needs an entry to check its conditions against."
    );
  });
});

describe("Preview as visitor elsewhere", () => {
  it("on a component, gives the reason it has no entry to check", () => {
    const { result } = renderHook(() => useSwitch({ kind: "component" }));
    expect(result.current.visitor.unavailable).toBe(
      "No entry to check here. The published page checks them where it’s placed."
    );
    expect(editorStrip(undefined, result.current)).toBeUndefined();
  });

  it("on a collection template, checks against the entry being previewed", () => {
    const { result, rerender } = renderHook(
      (props: { entry?: PreviewedEntry }) =>
        useSwitch({ kind: "template", preview: TEMPLATE, ...props }),
      { initialProps: {} }
    );
    // No entry previewed yet: nothing to check against.
    expect(result.current.visitor.unavailable).toBe(
      "Needs an entry to check its conditions against."
    );
    rerender({ entry: ENTRY });
    expect(result.current.visitor.unavailable).toBeUndefined();
    act(() => result.current.visitor.onChange(true));
    expect(appliedWith).toHaveBeenLastCalledWith(ENTRY);
    // The template's own entry, never the page read.
    expect(pageWanted).not.toHaveBeenCalledWith(true);
    expect(result.current.said).toBe("1 block hidden for this post");

    // The visitor's row sits under the Previewing row.
    render(<>{editorStrip(TEMPLATE, result.current)}</>);
    const previewing = screen.getByTestId("previewing");
    expect(previewing.textContent).toContain("Previewing as a visitor");
    expect(previewing.textContent).toContain("1 block hidden for this post");
  });
});
