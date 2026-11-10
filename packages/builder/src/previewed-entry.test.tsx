// @vitest-environment jsdom

/**
 * The previewed-entry seam: what a host hands the editor around a template,
 * and what anything inside reads of it.
 *
 * Outside a provider the answer is `undefined`, never a `none`: a page, a
 * component or a Layout previews nothing, which is not the same as a
 * template with no entry to preview. Both variants are read back as given,
 * and the type is held to the shape the host and the reader agreed.
 *
 * @module previewed-entry.test
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { ShortcutProvider, useShortcuts } from "@nextlyhq/ui";
import type { ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { MOVE_KEYS } from "./keyboard-actions";
import {
  PREVIEWED_ENTRY_KEYS,
  PreviewedEntryProvider,
  usePreviewedEntry,
  type PreviewedEntry,
} from "./shell";

/** A provider holding `value`, as the host mounts one around a template. */
function providing(value: PreviewedEntry) {
  return ({ children }: { children: ReactNode }) => (
    <PreviewedEntryProvider value={value}>{children}</PreviewedEntryProvider>
  );
}

const ENTRY: PreviewedEntry = {
  kind: "entry",
  collection: "posts",
  id: "p1",
  title: "Building a content model that lasts",
  publicValues: { title: "Building a content model that lasts" },
  editorValues: { title: "Building a content model that lasts (draft)" },
  fields: [{ name: "title", type: "text" }],
};

describe("usePreviewedEntry", () => {
  it("answers undefined where no template is being edited", () => {
    const { result } = renderHook(() => usePreviewedEntry());
    expect(result.current).toBeUndefined();
  });

  it("answers the entry a template is previewed with, as the host gave it", () => {
    const { result } = renderHook(() => usePreviewedEntry(), {
      wrapper: providing(ENTRY),
    });
    expect(result.current).toBe(ENTRY);
  });

  it("answers why there is no entry, apart from there being no template", () => {
    const none: PreviewedEntry = { kind: "none", reason: "empty" };
    const { result } = renderHook(() => usePreviewedEntry(), {
      wrapper: providing(none),
    });
    expect(result.current).toEqual({ kind: "none", reason: "empty" });
  });

  it("is shaped as agreed: an entry with both readings and the public fields, or none with a reason", () => {
    type Entry = Extract<PreviewedEntry, { kind: "entry" }>;
    type None = Extract<PreviewedEntry, { kind: "none" }>;
    expectTypeOf<Entry>().toEqualTypeOf<{
      readonly kind: "entry";
      readonly collection: string;
      readonly id: string;
      readonly title: string;
      readonly publicValues: Readonly<Record<string, unknown>> | null;
      readonly editorValues: Readonly<Record<string, unknown>>;
      readonly fields: readonly BindingFieldShape[];
    }>();
    expectTypeOf<None>().toEqualTypeOf<{
      readonly kind: "none";
      readonly reason: "empty" | "loading" | "unavailable";
    }>();
    expectTypeOf(usePreviewedEntry).returns.toEqualTypeOf<
      PreviewedEntry | undefined
    >();
  });
});

describe("the keys that preview another entry", () => {
  afterEach(cleanup);

  /**
   * The block moves' own bindings, by the specs the editor registers, beside
   * the preview's, under one shortcut manager as the shell holds them.
   */
  function Keys({
    moved,
    switched,
  }: {
    moved: (direction: string) => void;
    switched: (by: 1 | -1) => void;
  }): null {
    useShortcuts(
      MOVE_KEYS.map(move => ({
        keys: move.keys,
        description: move.description,
        whenTyping: false,
        run: () => moved(move.direction),
      })),
      { name: "Block moves" }
    );
    useShortcuts(
      [
        {
          keys: PREVIEWED_ENTRY_KEYS.next,
          description: "Preview the next entry",
          whenTyping: false,
          run: () => switched(1),
        },
        {
          keys: PREVIEWED_ENTRY_KEYS.previous,
          description: "Preview the previous entry",
          whenTyping: false,
          run: () => switched(-1),
        },
      ],
      { name: "Template preview" }
    );
    return null;
  }

  function renderKeys() {
    const moved = vi.fn();
    const switched = vi.fn();
    render(
      <ShortcutProvider>
        <Keys moved={moved} switched={switched} />
      </ShortcutProvider>
    );
    return { moved, switched };
  }

  it("switch with Shift held, and move no block", () => {
    const { moved, switched } = renderKeys();
    fireEvent.keyDown(document.body, {
      key: "ArrowDown",
      altKey: true,
      shiftKey: true,
    });
    fireEvent.keyDown(document.body, {
      key: "ArrowUp",
      altKey: true,
      shiftKey: true,
    });
    expect(switched.mock.calls).toEqual([[1], [-1]]);
    expect(moved).not.toHaveBeenCalled();
  });

  it("leave Alt with an arrow to move the block, and switch nothing (the control)", () => {
    const { moved, switched } = renderKeys();
    fireEvent.keyDown(document.body, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(document.body, { key: "ArrowUp", altKey: true });
    expect(moved.mock.calls).toEqual([["down"], ["up"]]);
    expect(switched).not.toHaveBeenCalled();
  });
});
