"use client";

/**
 * The recovery offer, handed from a document view's body to the save chip the
 * view draws, so the offer is made in the save state the author already reads
 * rather than in a second strip above the editor.
 *
 * A chip that shows the offer CLAIMS it, and the body then draws no banner. A
 * view that draws no chip claims nothing, so its author keeps the banner: the
 * offer is never lost because a view chose its own controls.
 *
 * @module components/features/entries/EntryForm/RecoveryOfferContext
 */
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

/** A recovery point on offer: when it was stored, and the two answers. */
export interface HostedRecoveryOffer {
  savedAt: Date;
  /** Whether it is from an older version; see `AutosaveRecoveryOffer`. */
  olderVersion?: boolean;
  /** Write the recovered values into the document. */
  restore: () => void;
  /** Stop offering for this session, without deleting anything. */
  dismiss: () => void;
}

interface RecoveryOfferValue {
  offer: HostedRecoveryOffer | null;
  /** Marks the offer as shown; returns the release for when the chip goes. */
  claim: () => () => void;
}

const RecoveryOfferContext = createContext<RecoveryOfferValue | null>(null);

/**
 * The body's side: the offer to hand down, and whether a chip has claimed it.
 * Counted, so a chip that remounts releases its claim before the next one
 * takes it.
 */
export function useRecoveryOfferHost(offer: HostedRecoveryOffer | null): {
  value: RecoveryOfferValue;
  claimed: boolean;
} {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims(count => count + 1);
    return () => setClaims(count => count - 1);
  }, []);
  const value = useMemo(() => ({ offer, claim }), [offer, claim]);
  return { value, claimed: claims > 0 };
}

export function RecoveryOfferProvider({
  value,
  children,
}: {
  value: RecoveryOfferValue;
  children: ReactNode;
}) {
  return (
    <RecoveryOfferContext.Provider value={value}>
      {children}
    </RecoveryOfferContext.Provider>
  );
}

/** The chip's side: the offer it may show. Null outside a document view. */
export function useHostedRecoveryOffer(): HostedRecoveryOffer | null {
  return useContext(RecoveryOfferContext)?.offer ?? null;
}

/**
 * Claims the offer for as long as the caller is mounted: called by the control
 * that actually makes the offer, not by the chip around it, so a chip showing
 * something else (a failed save) leaves the banner in place. Claimed in a
 * layout effect, so the banner is gone before the first paint.
 */
export function useClaimRecoveryOffer(): void {
  const claim = useContext(RecoveryOfferContext)?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
}
