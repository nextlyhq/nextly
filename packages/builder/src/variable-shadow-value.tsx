"use client";

/**
 * A shadow variable's Light or Dark value, built with the shadow control
 * rather than typed as one line of CSS.
 *
 * @module variable-shadow-value
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { ShadowControl } from "./shadow-control";
import { ModeIcon } from "./variable-popup-parts";
import type { ValueFieldProps } from "./variable-value-controls";

/**
 * The site's variables, for a shadow's Colour: a value field is handed its
 * own value alone, and a shadow coloured by a colour variable names one.
 */
export const ShadowVariables: React.Context<SiteTokenSet | undefined> =
  React.createContext<SiteTokenSet | undefined>(undefined);

/**
 * The value under its mode's label. What it writes is the variable's own
 * declaration, shown on hover and, while "Show CSS names" is on, its custom
 * property inline.
 */
export function ShadowValue({
  label,
  value,
  readOnly,
  refusedBy,
  onCommit,
  css,
  mode = "light",
}: ValueFieldProps): React.JSX.Element {
  const tokens = React.useContext(ShadowVariables);
  const property = css?.split(":")[0]?.trim();
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label">
        <ModeIcon mode={mode} />
        {label}
      </span>
      <ShadowControl
        label={label}
        value={value}
        tokens={tokens}
        readOnly={readOnly}
        refusedBy={refusedBy}
        writesOf={
          property === undefined ? undefined : next => `${property}: ${next}`
        }
        names={property === undefined ? undefined : [property]}
        onCommit={onCommit}
      />
    </div>
  );
}
