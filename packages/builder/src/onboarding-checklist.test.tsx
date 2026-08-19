// @vitest-environment jsdom
/**
 * Whether the card is on screen, and what stops it being.
 *
 * The steps themselves are `onboarding.test`; this is only the visibility rule
 * and the dismissal, which are the parts a host can get wrong.
 *
 * @module onboarding-checklist.test
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { useBuilderChecklist } from "./onboarding-checklist";
import type { PreferenceStore } from "./shell-state";

afterEach(clearBlocks);

function register() {
  if (hasBlock("acme/heading")) return;
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/heading",
        props: { text: { type: "text", inline: true } },
      },
    ] as never,
    { source: "checklist-test" }
  );
}

function documentOf(nodes: BlockNode[] = []): BlockDocument {
  register();
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** A store that remembers, so a dismissal can be observed rather than inferred. */
function fakeStore(initial: string | null = null): PreferenceStore & {
  written: string[];
} {
  let value = initial;
  const written: string[] = [];
  return {
    written,
    read: () => value,
    write: next => {
      written.push(next);
      value = next;
    },
  };
}

describe("useBuilderChecklist", () => {
  it("is visible on a page nobody has dismissed it for", () => {
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: documentOf(), store: fakeStore() })
    );

    expect(result.current.visible).toBe(true);
    expect(result.current.steps.length).toBeGreaterThan(0);
  });

  it("stays hidden once it has been dismissed before", () => {
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: documentOf(), store: fakeStore("true") })
    );

    expect(result.current.visible).toBe(false);
  });

  it("hides on dismiss AND records it, so it stays hidden next time", () => {
    // Both halves. Hiding without recording gives an author a card that comes
    // back on every reload; recording without hiding does nothing they asked
    // for.
    const store = fakeStore();
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: documentOf(), store })
    );

    act(() => result.current.dismiss());

    expect(result.current.visible).toBe(false);
    expect(store.written).toEqual(["true"]);
  });

  it("still hides when storage REFUSES the write", () => {
    // Private browsing throws on write. An author who cannot persist the
    // dismissal should still get the card off their screen for this session.
    const refusing: PreferenceStore = {
      read: () => null,
      write: () => {
        throw new Error("storage disabled");
      },
    };
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: documentOf(), store: refusing })
    );

    act(() => result.current.dismiss());

    expect(result.current.visible).toBe(false);
  });

  it("is hidden by the host's switch without anyone dismissing it", () => {
    const store = fakeStore();
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: documentOf(), enabled: false, store })
    );

    expect(result.current.visible).toBe(false);
    // The switch is not a dismissal: turning it back on must show the card
    // again rather than find it already dismissed for everyone.
    expect(store.written).toEqual([]);
  });

  it("is visible when the switch is on, which is the control", () => {
    // Without this, the two cases above pass on a hook that never shows the
    // card under any circumstances.
    const { result } = renderHook(() =>
      useBuilderChecklist({
        document: documentOf(),
        enabled: true,
        store: fakeStore(),
      })
    );

    expect(result.current.visible).toBe(true);
  });

  it("reports the steps for the page it was given", () => {
    const withBlock = documentOf([
      {
        id: "a",
        type: "acme/heading",
        version: 1,
        props: { text: "Hi" },
      } as BlockNode,
    ]);
    const { result } = renderHook(() =>
      useBuilderChecklist({ document: withBlock, store: fakeStore() })
    );

    expect(result.current.steps.find(s => s.id === "add-block")?.done).toBe(
      true
    );
    expect(result.current.steps.find(s => s.id === "write-text")?.done).toBe(
      true
    );
    expect(result.current.steps.find(s => s.id === "build-page")?.done).toBe(
      false
    );
  });
});
