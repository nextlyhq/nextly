"use client";

/**
 * A block's shadow in its Style tab: the shadow control a shadow variable is
 * built with in Design, and the ◇ to use one of the site's shadow variables
 * instead.
 *
 * @module style-shadow-field
 */
import type { SiteTokenSet, StyleValue } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { ShadowControl } from "./shadow-control";
import type { StyleControl } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { VariableChoice } from "./variable-choice";

/** The CSS property the shadow control draws in the Style tab. */
export const BOX_SHADOW = "box-shadow";

/**
 * Whether the shadow control draws a box shadow's stored value: one written
 * as CSS, or none yet. A held variable keeps its chip.
 */
export function drawsShadow(stored: StyleValue | undefined): boolean {
  return stored === undefined || typeof stored === "string";
}

export function ShadowField({
  id,
  control,
  stored,
  actionName,
  tokens,
  describedBy,
  onCommit,
}: {
  id: string;
  /** The field label's id; the control is a group named by its own label. */
  labelledBy: string;
  control: StyleControl;
  stored: StyleValue | undefined;
  actionName: string;
  tokens: SiteTokenSet | undefined;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  return (
    <div className="nx-shadow-field" id={id}>
      <ShadowControl
        label={actionName}
        value={typeof stored === "string" ? stored : ""}
        tokens={tokens}
        readOnly={false}
        refusedBy={describedBy}
        // What it writes is said by the field around it, on hover and inline.
        onCommit={css => {
          onCommit(css);
        }}
      />
      <VariableChoice
        leaf={control.leaf}
        tokens={tokens}
        bound={false}
        empty={stored === undefined}
        current={undefined}
        label={actionName}
        onPick={identity => onCommit({ $token: identity })}
      />
    </div>
  );
}
