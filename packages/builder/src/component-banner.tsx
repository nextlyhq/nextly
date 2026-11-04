"use client";

/**
 * The banner over a component's own view: which component this is, how many
 * pages a change to it reaches, and the one way back to where the author came
 * from, named for where it goes.
 *
 * A component edited here changes every page that shows it, which the canvas
 * does not say: it draws the component as one placement would. So the banner
 * stays for as long as the view is open, above the editor's own bar, tinted
 * with the component's hue so the whole view reads as "the shared thing".
 *
 * ONE Back. The editor's own exit arrow is withheld while this one is offered
 * (the host decides that), since two arrows going to two places is a choice
 * the author should not have to make blind.
 *
 * Draws only. Where Back goes, its name, and how far the change reaches are
 * the host's answers, handed in.
 *
 * @module component-banner
 */
import { Button } from "@nextlyhq/ui";
import { ArrowLeft, Component } from "lucide-react";
import * as React from "react";

import type { ComponentFieldsHost } from "./component-fields";
import { BUILDER_TOKENS_CLASS } from "./shell-state";

/**
 * What the banner says a change reaches, from the host's count of the pages
 * showing the component (directly, inside another component, or in a Layout
 * around them), or nothing while there is no count. A floor is said as "at
 * least", and only a floor: an exact count is said as it is.
 */
export function reachSentence(
  pages: ComponentFieldsHost["pages"]
): string | undefined {
  if (pages === undefined) return undefined;
  if (pages.count === 0) {
    return pages.complete ? "Not on any page yet" : undefined;
  }
  const noun = pages.count === 1 ? "page" : "pages";
  return pages.complete
    ? `Changes reach ${pages.count} ${noun}`
    : `Changes reach at least ${pages.count} ${noun}`;
}

/** What the band says on hover and to a screen reader: when the change lands. */
const BAND_HINT = "Every page that uses it updates when you save.";

/** @experimental Settles when the component editor ships. */
export interface ComponentBannerProps {
  /** The component's name, or nothing while it is not known. */
  readonly name: string | undefined;
  /** How many pages a change reaches; nothing while it is not counted. */
  readonly pages: ComponentFieldsHost["pages"];
  /**
   * The way back: where it goes, said as "Back to <to>", and the move.
   * Omitted, no Back is offered.
   */
  readonly back?:
    | { readonly to: string; readonly onBack: () => void }
    | undefined;
}

/** @experimental Settles when the component editor ships. */
export function ComponentBanner({
  name,
  pages,
  back,
}: ComponentBannerProps): React.JSX.Element {
  const said = reachSentence(pages);
  const hintId = React.useId();
  return (
    <div
      // The builder's own tokens, so the component hue resolves here too: the
      // band sits above the shell, outside the chrome that declares them.
      className={`nx-component-banner ${BUILDER_TOKENS_CLASS}`}
      role="region"
      aria-label="Editing a component"
      // The pill this replaced, as the band's tooltip and its description.
      title={BAND_HINT}
      aria-describedby={hintId}
    >
      <span id={hintId} className="nx-sr-only">
        {BAND_HINT}
      </span>
      {back === undefined ? null : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nx-component-banner__back"
            onClick={back.onBack}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back <span className="nx-component-banner__to">to {back.to}</span>
          </Button>
          <span className="nx-component-banner__rule" aria-hidden="true" />
        </>
      )}
      <p className="nx-component-banner__text">
        <span className="nx-component-banner__editing">
          <Component
            size={15}
            aria-hidden="true"
            className="nx-component-banner__glyph"
          />
          Editing component
        </span>
        <strong className="nx-component-banner__name">
          {name ?? "this component"}
        </strong>
        {said === undefined ? null : (
          <span className="nx-component-banner__reach">· {said}</span>
        )}
      </p>
    </div>
  );
}
