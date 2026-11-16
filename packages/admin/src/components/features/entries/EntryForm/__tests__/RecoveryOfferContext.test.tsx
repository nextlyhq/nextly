/**
 * Who makes the recovery offer: the save chip's own control, claimed only
 * while it is drawn, so a chip that shows something else leaves the banner.
 *
 * @module components/features/entries/EntryForm/__tests__/RecoveryOfferContext.test
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  RecoveryOfferProvider,
  useRecoveryOfferHost,
  type HostedRecoveryOffer,
} from "../RecoveryOfferContext";
import { SaveStateIndicator } from "../SaveStateIndicator";
import type { DocumentSaveState } from "../useDocumentActionBindings";

const offer: HostedRecoveryOffer = {
  savedAt: new Date(),
  restore: vi.fn(),
  dismiss: vi.fn(),
};

/** A host and a chip, saying whether the banner would stand down. */
function Body({ saveState }: { saveState: DocumentSaveState }) {
  const host = useRecoveryOfferHost(offer);
  return (
    <RecoveryOfferProvider value={host.value}>
      <p>{host.claimed ? "claimed" : "banner"}</p>
      <SaveStateIndicator
        saveState={saveState}
        recovery={{
          enabled: true,
          storedAt: null,
          pendingOfferAt: offer.savedAt,
        }}
        offer={offer}
      />
    </RecoveryOfferProvider>
  );
}

describe("the recovery offer's claim", () => {
  it("is taken while the chip makes the offer", () => {
    render(<Body saveState={{ kind: "unsaved" }} />);
    expect(screen.getByText("claimed")).toBeTruthy();
  });

  it("is left while the chip shows a failed save, so the banner keeps the offer", () => {
    render(
      <Body
        saveState={{ kind: "failed", message: "The server did not answer." }}
      />
    );
    expect(screen.getByText("banner")).toBeTruthy();
    expect(screen.getByText("Not saved")).toBeTruthy();
  });
});
