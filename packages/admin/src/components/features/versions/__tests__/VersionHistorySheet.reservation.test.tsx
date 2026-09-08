/**
 * Whether the history panel sits BESIDE the document or over it.
 *
 * The panel is `position: fixed`, so nothing about opening it moves the page:
 * without a reservation the document keeps its full width and draws underneath,
 * and every control in the covered strip stays visible and enabled while the
 * pointer lands on the panel instead. That failure is silent in both
 * directions — no error, no disabled state, no visual change — which is why it
 * survived on `main` with the editor's Save, Publish and overflow menu all
 * unreachable whenever history was open.
 *
 * Kept out of `VersionHistorySheet.test` because that file mocks the panel's
 * transport to be about what it renders. This is about what it asks the LAYOUT
 * for, which is a different seam and one no rendering assertion reaches.
 *
 * @module components/features/versions/__tests__/VersionHistorySheet.reservation.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { answerMediaQueries } from "@admin/__tests__/helpers/media-query";
import { render, screen } from "@admin/__tests__/utils";
import {
  SidePanelReservationProvider,
  useReservedInlineEnd,
} from "@admin/components/layout/SidePanelReservation";

import { VersionHistorySheet } from "../VersionHistorySheet";

vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersions: () => ({
    data: { pages: [{ items: [], meta: { total: 0 } }] },
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useVersion: () => ({ data: undefined, isLoading: false, error: null }),
  useRestoreVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSetVersionLabel: () => ({ mutate: vi.fn(), isPending: false }),
}));

/**
 * Reports the indent the layout would apply, read out of a RENDER so the
 * assertion is on the value the content column actually receives.
 */
function ColumnProbe() {
  return <div data-testid="reserved">{String(useReservedInlineEnd())}</div>;
}

function renderPanel(open: boolean) {
  return render(
    <SidePanelReservationProvider>
      <ColumnProbe />
      <VersionHistorySheet
        open={open}
        onOpenChange={vi.fn()}
        scope={{ kind: "collection", slug: "posts", entryId: "1" }}
      />
    </SidePanelReservationProvider>
  );
}

const reserved = () => screen.getByTestId("reserved").textContent;
const overlay = () => document.querySelector('[data-slot="sheet-overlay"]');

describe("a window wide enough to hold the panel beside the document", () => {
  // The panel asks the window whether it can hold both; jsdom answers no
  // unless told, so a test about the wide case has to state it.
  beforeEach(() => answerMediaQueries(true));

  it("reserves the panel's width, so nothing is left underneath it", async () => {
    renderPanel(true);
    // 480, from the panel's own constant. The number is the point: an indent
    // narrower than the panel leaves a covered strip, which is the defect.
    expect(reserved()).toBe("480");
  });

  it("leaves the document live, with no scrim over it", () => {
    // The other half of the same decision. Room having been made, the panel has
    // no reason to withdraw the document — an editor reads history to act on it.
    renderPanel(true);
    expect(overlay()).toBeNull();
  });

  it("reserves nothing while it is closed", () => {
    // The control. An unconditional reservation would satisfy the first case
    // and indent every page in the admin by 480px forever.
    renderPanel(false);
    expect(reserved()).toBe("0");
  });
});

describe("a window too narrow to hold both", () => {
  beforeEach(() => answerMediaQueries(false));

  it("reserves nothing, because there is nothing to reserve it from", () => {
    renderPanel(true);
    expect(reserved()).toBe("0");
  });

  it("covers the document as a modal instead, which REFUSES the clicks", () => {
    /*
     * The honest state, and the reason this is not simply "do nothing when
     * narrow". The panel covers the document either way; a modal one blocks
     * interaction outright and says so, while a non-modal one accepts every
     * click into nothing. A scrim is the visible half of that.
     */
    renderPanel(true);
    expect(overlay()).not.toBeNull();
  });
});
