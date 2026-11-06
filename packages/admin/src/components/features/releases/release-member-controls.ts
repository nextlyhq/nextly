/**
 * What the release page offers on each of a release's documents, from what
 * the server says this reader may do to the release.
 *
 * Nothing here decides a permission. The server sends `can` with the release,
 * judged from the release's state and the reader's grants; this only says
 * which of those answers each control stands on, and what a control that is
 * shown but not usable says about why.
 *
 * @module components/features/releases/release-member-controls
 */
import type { Release } from "@admin/types/releases";

/** The remove control of one document, as the page draws it. */
export interface MemberRemoveControl {
  /** Whether the control is drawn at all. */
  offered: boolean;
  /**
   * Whether taking the document out cancels the release: the one document a
   * single-document release holds is the release, and a release with none
   * left would run with nothing in it.
   */
  cancelsRelease: boolean;
  /** Why the drawn control cannot be used, or `null` when it can. */
  disabledReason: string | null;
}

/** The controls of one document of a release. */
export interface MemberControls {
  /** Whether it may be switched between going live and coming down. */
  switchAction: boolean;
  remove: MemberRemoveControl;
}

/** Why a reader may take out a single release's document but not cancel it. */
export const CANCEL_NEEDED_REASON =
  "Taking out its only document cancels this release, which needs the permission to schedule or cancel releases.";

/**
 * The controls each document of `release` carries for this reader.
 *
 * - Removing stands on `can.removeMember`. In a single-document release it
 *   also cancels the release, so it stands on `can.cancel` as well: it is
 *   drawn, so the reader learns it exists, and disabled with the reason when
 *   they may not cancel.
 * - Switching stands on `can.removeMember` too. The server fences a switch
 *   with the same release states and authority as a removal of a document
 *   from an ordinary release, and sends no capability of its own for it, so
 *   this offers it only where that membership change is allowed. The
 *   document's own publish or unpublish authority is the write's to judge, as
 *   it is for an add.
 */
export function memberControls(
  release: Pick<Release, "kind" | "can">
): MemberControls {
  const mayRemove = release.can?.removeMember === true;
  const single = release.kind === "single";
  const mayCancel = release.can?.cancel === true;
  return {
    switchAction: mayRemove,
    remove: {
      offered: mayRemove,
      cancelsRelease: single,
      disabledReason: single && !mayCancel ? CANCEL_NEEDED_REASON : null,
    },
  };
}
