/**
 * Whether the pane's revision actually MOVES when a save lands.
 *
 * Tested here rather than through the form, and the reason is worth recording
 * because the obvious place does not work. `SingleForm.preview-pane.test.tsx`
 * replaces the header, and `onSaveChanges` — the callback the form wires to its
 * own `handleSubmit` — can be invoked from there, but the submit never reaches
 * `onSubmit`: the form's fields do not render under that harness, so
 * `handleSubmit`'s validated callback never runs. Driving a save there proves
 * nothing about this.
 *
 * So the form test asserts the count is THREADED, and this one asserts the
 * count MOVES the answer. Neither alone is the property: a count threaded but
 * frozen satisfies the first, and a revision that moves for a count nothing
 * supplies satisfies the second.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSinglePreviewPane } from "../useSinglePreviewPane";
import type { SinglePreviewLink } from "../useSinglePreviewLink";

const link: SinglePreviewLink = {
  isAvailable: true,
  copy: () => {},
  isCopying: false,
  scope: { single: "landing-page", locale: "en" },
};

/**
 * A PUBLISHED Single whose sidecar save moves nothing the document exposes.
 *
 * `updatedAt` and the working-draft flag are deliberately constant across every
 * case below: a status-less save writes the working-draft row and leaves the
 * live one alone, so this is the shape the admin really receives, and the count
 * is the only thing that can distinguish one save from the next.
 */
const document = {
  id: "s1",
  updatedAt: "2026-08-26T10:00:00.000Z",
  _isWorkingDraft: true,
};

function revisionAt(savedCount: number): string {
  const { result } = renderHook(() =>
    useSinglePreviewPane({
      link,
      document,
      savedCount,
      inTranslationMode: false,
    })
  );
  return result.current.revision;
}

describe("the revision a Single's pane refreshes on", () => {
  it("moves when a save lands, though the document has not changed", () => {
    expect(revisionAt(1)).not.toBe(revisionAt(0));
  });

  it("keeps moving across a run of saves", () => {
    const seen = [0, 1, 2, 3, 4].map(revisionAt);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("does NOT move when nothing saved", () => {
    // The control: the revision is a function of its inputs rather than
    // something that changes on every render, which would refresh the frame
    // continuously and reload the site on every keystroke.
    expect(revisionAt(3)).toBe(revisionAt(3));
  });

  it("still moves when the DOCUMENT changes under an unchanged count", () => {
    /*
     * The other half of the union. Discarding a working draft persists through
     * its own mutation, so the count does not move — and only the flag going
     * false says the frame is showing content that no longer exists.
     */
    const { result } = renderHook(() =>
      useSinglePreviewPane({
        link,
        document: { ...document, _isWorkingDraft: false },
        savedCount: 3,
        inTranslationMode: false,
      })
    );

    expect(result.current.revision).not.toBe(revisionAt(3));
  });
});

describe("availability disappearing under an OPEN pane", () => {
  function paneWith(isAvailable: boolean, inTranslationMode = false) {
    return renderHook(
      ({
        available,
        translating,
      }: {
        available: boolean;
        translating: boolean;
      }) =>
        useSinglePreviewPane({
          link: { ...link, isAvailable: available },
          document,
          savedCount: 0,
          inTranslationMode: translating,
        }),
      {
        initialProps: {
          available: isAvailable,
          translating: inTranslationMode,
        },
      }
    );
  }

  it("does not spring back open when availability returns", () => {
    /*
     * Masking is not closing. `open && canOffer` hides the pane while leaving
     * the state true, so ending translation mode — or the locale resolving —
     * reopens it and mints a credential nobody asked for. Observing only the
     * unavailable render cannot tell the two apart, which is why this rerenders
     * BACK to an available state: that is the only moment they differ.
     */
    const { result, rerender } = paneWith(true);

    act(() => {
      (
        result.current.toggle as { onTogglePreviewPane: () => void }
      ).onTogglePreviewPane();
    });
    expect(result.current.open).toBe(true);

    rerender({ available: false, translating: false });
    expect(result.current.open).toBe(false);

    // The moment that separates closed from masked.
    rerender({ available: true, translating: false });
    expect(result.current.open).toBe(false);
  });

  it("reopens on a deliberate toggle, so the state is not stuck shut", () => {
    // The control: closing it was availability doing its job, not the pane
    // losing the ability to open.
    const { result, rerender } = paneWith(true);

    rerender({ available: false, translating: false });
    rerender({ available: true, translating: false });

    act(() => {
      (
        result.current.toggle as { onTogglePreviewPane: () => void }
      ).onTogglePreviewPane();
    });

    expect(result.current.open).toBe(true);
  });
});
