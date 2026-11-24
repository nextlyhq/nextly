"use client";

/**
 * A past version's own actions, drawn where the live document's Save and
 * Publish stand while the version is on screen: Compare, Back to current, and
 * Restore…. Save and Publish act on the live document, which is not what is
 * being read, so they are replaced rather than greyed.
 *
 * One component for every title bar that draws a past version, so none of
 * them offers a different set or a different order. The host keeps its own
 * History control before these and its menu after them.
 *
 * @module components/features/versions/PastVersionActions
 */

import type { JSX } from "react";

import { Button } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";

import type { VersionActions } from "./version-actions";

export interface PastVersionActionsProps {
  /** What the version on screen offers, from `useVersionActions`. */
  versionActions: VersionActions;
  /**
   * Put on each control, so a host can hide them where another surface
   * offers them instead (a phone's bottom bar).
   */
  buttonClassName?: string;
}

export function PastVersionActions({
  versionActions,
  buttonClassName,
}: PastVersionActionsProps): JSX.Element {
  return (
    <>
      {versionActions.compareHref ? (
        // A link, since it goes somewhere: the comparison page has an
        // address of its own, which opens in a new tab like any other.
        <Button asChild variant="outline" size="sm" className={buttonClassName}>
          <Link href={versionActions.compareHref}>Compare</Link>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={buttonClassName}
        onClick={versionActions.returnToCurrent}
      >
        Back to current
      </Button>
      {versionActions.restore ? (
        <Button
          type="button"
          size="sm"
          className={buttonClassName}
          disabled={versionActions.restoreDisabled}
          onClick={versionActions.restore}
        >
          {/* The dialog that follows lists what it puts back, so the button
              promises a choice rather than naming one. */}
          Restore…
        </Button>
      ) : null}
    </>
  );
}
