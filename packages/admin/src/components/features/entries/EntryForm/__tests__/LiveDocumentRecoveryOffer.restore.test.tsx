/**
 * Restore on the editor's recovery offer restores the point.
 *
 * The recovery's restore takes an optional step of its own to run in place of
 * writing the values (`apply`). The button's click hands its handler an
 * event; passed straight through, that event became the step, and calling it
 * failed, so Restore restored nothing.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";

import { LiveDocumentRecoveryOffer } from "../AutosaveRecoveryBanner";

describe("the editor's recovery offer", () => {
  it("asks the recovery to restore with no step of its own", async () => {
    const restore = vi.fn();
    const recovery = {
      offer: {
        savedAt: new Date(Date.now() - 60_000),
        snapshot: { title: "recovered" },
        olderVersion: false,
        startingVersionUnknown: false,
      },
      isResolved: true,
      dismiss: vi.fn(),
      restore,
      take: vi.fn(),
      recheck: vi.fn(),
    } satisfies UseAutosaveRecoveryResult;
    render(
      <LiveDocumentRecoveryOffer recovery={recovery} viewingVersion={null} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith();
  });
});
