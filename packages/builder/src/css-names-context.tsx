"use client";

/**
 * Whether the block panel prints each control's CSS names under its label,
 * the "Show CSS names" preference: the shell's, kept with its other
 * preferences, or the panel's own where it is mounted alone.
 *
 * The provider also supplies the tooltips' provider, so a panel mounted
 * without the shell still draws a control's "what it writes" tooltip.
 *
 * @module css-names-context
 */
import { TooltipProvider } from "@nextlyhq/ui";
import * as React from "react";

/** The preference and the way to change it. */
export interface CssNames {
  readonly shown: boolean;
  readonly set: (shown: boolean) => void;
}

/** The shell's preference, for a panel inside the shell. */
export const CssNamesContext: React.Context<CssNames | undefined> =
  React.createContext<CssNames | undefined>(undefined);

const NOT_SHOWN: CssNames = { shown: false, set: () => {} };

/** Whether CSS names are printed, and the way to change it. */
export function useCssNames(): CssNames {
  return React.useContext(CssNamesContext) ?? NOT_SHOWN;
}

/**
 * Lends the preference to the panel inside it: the one lent from above, else
 * the panel's own, off at first; and a tooltip provider for the controls.
 */
export function CssNamesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const above = React.useContext(CssNamesContext);
  const [own, setOwn] = React.useState(false);
  const value = React.useMemo<CssNames>(
    () => above ?? { shown: own, set: setOwn },
    [above, own]
  );
  return (
    <CssNamesContext.Provider value={value}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </CssNamesContext.Provider>
  );
}
