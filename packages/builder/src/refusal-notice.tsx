"use client";

/**
 * The notice that says why a dragged block cannot land, and what would.
 *
 * One component for both places a drag is refused, the canvas and Layers, so
 * an author reads the refusal on the same surface in the same words wherever
 * they drag: the editor's notice surface with a red edge and a warning mark,
 * not a red fill, so the reason reads beside ordinary content at AA contrast
 * in both themes. Each place only positions it.
 *
 * @module refusal-notice
 */
import { CircleAlert } from "lucide-react";
import * as React from "react";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";

/** The two lines of a refusal, and where its place puts it. */
export interface RefusalNoticeProps {
  /** Why the drop will not happen. */
  readonly headline: string;
  /** What the spot or the block takes instead, when the rule names it. */
  readonly remedy: string | null;
  /** The place's own class, which positions the notice there. */
  readonly className: string;
  /** Where the place puts it, worked out by the place. */
  readonly style?: React.CSSProperties;
}

/**
 * A refusal's notice.
 *
 * Hidden from assistive technology: it describes a POINTER gesture, and each
 * place announces the same sentence through its own live region to the one
 * who is dragging. Marked as chrome, so a canvas's hit-testing skips it.
 */
export const RefusalNotice: React.ForwardRefExoticComponent<
  RefusalNoticeProps & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<HTMLDivElement, RefusalNoticeProps>(function RefusalNotice(
  { headline, remedy, className, style },
  ref
) {
  return (
    <div
      ref={ref}
      className={`nx-refusal-notice ${className}`}
      {...{ [CHROME_ATTRIBUTE]: "" }}
      style={style}
      aria-hidden="true"
    >
      <CircleAlert
        className="nx-refusal-notice__mark"
        size={14}
        aria-hidden="true"
      />
      <span className="nx-refusal-notice__text">
        <span className="nx-refusal-notice__why">{headline}</span>
        {remedy === null ? null : (
          <span className="nx-refusal-notice__takes">{remedy}</span>
        )}
      </span>
    </div>
  );
});
