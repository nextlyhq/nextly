"use client";

/**
 * The banner over a component's own view: which component this is, how far a
 * change to it reaches, and the way back to where the author came from.
 *
 * A component edited here changes every document that places it, which the
 * canvas does not say: it draws the component as one placement would. So the
 * banner stays for as long as the view is open, above the editor's own bar.
 *
 * Draws only. Where Back goes, and how far the change reaches, are the host's
 * answers, handed in.
 *
 * @module component-banner
 */
import { Button } from "@nextlyhq/ui";
import { ArrowLeft, Component } from "lucide-react";
import * as React from "react";

import type { ComponentFieldsHost } from "./component-fields";

/**
 * What the banner says a change reaches, from the host's count of documents
 * placing the component directly, or nothing while there is no count. A floor
 * is said as "at least"; pages reaching it through another component are not
 * in the count, so it is said as documents rather than pages.
 */
export function reachSentence(
  reach: ComponentFieldsHost["reach"]
): string | undefined {
  if (reach === undefined) return undefined;
  if (reach.count === 0) {
    return reach.complete ? "Nothing places it yet." : undefined;
  }
  const documents =
    reach.count === 1
      ? "the 1 document that places it"
      : `the ${reach.count} documents that place it`;
  return reach.complete
    ? `Changes reach ${documents}.`
    : `Changes reach at least ${documents}.`;
}

/** @experimental Settles when the component editor ships. */
export interface ComponentBannerProps {
  /** The component's name, or nothing while it is not known. */
  readonly name: string | undefined;
  readonly reach: ComponentFieldsHost["reach"];
  /** Go back to where the author came from; omitted, no Back is offered. */
  readonly onBack?: (() => void) | undefined;
}

/** @experimental Settles when the component editor ships. */
export function ComponentBanner({
  name,
  reach,
  onBack,
}: ComponentBannerProps): React.JSX.Element {
  const said = reachSentence(reach);
  return (
    <div
      className="nx-component-banner"
      role="region"
      aria-label="Editing a component"
    >
      {onBack === undefined ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </Button>
      )}
      <Component
        size={16}
        aria-hidden="true"
        className="nx-component-banner__glyph"
      />
      <p className="nx-component-banner__text">
        Editing component{" "}
        <strong className="nx-component-banner__name">
          {name ?? "this component"}
        </strong>
        {said === undefined ? null : (
          <span className="nx-component-banner__reach">{said}</span>
        )}
      </p>
    </div>
  );
}
