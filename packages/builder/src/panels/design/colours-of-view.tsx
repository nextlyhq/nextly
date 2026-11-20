"use client";

/**
 * What the Colours tab lists while the site hides its unused built-in
 * colours, and the setting that ends the tab: the tab's usage filter with
 * the hidden colours left out, read by the one rule the pickers read too
 * ({@link hiddenColours}).
 *
 * @module colours-of-view
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  BuiltInColoursSetting,
  builtInColoursShown,
  useHiddenReadAgain,
} from "./built-in-colours";
import { hiddenColours } from "./colour-usage";
import { useColourFilter } from "./colour-usage-filter";
import type { VariableEntry, VariableGroup } from "./tokens-studio";
import { usageState } from "./variable-usage";
import type { VariableUsageHere } from "./variable-usage-view";

/**
 * The built-in colours the view leaves out while the site hides them, read
 * by the one rule the pickers read too, and whether a listed built-in
 * colour's row says so. Their use is read again a moment after the site's
 * variables change, since a variable naming one makes it used.
 */
function useHiddenOfView({
  tokens,
  groups,
  usage,
  builtIn,
  usedOnPage,
}: {
  tokens: SiteTokenSet | undefined;
  groups: Parameters<typeof colourIdentities>[0];
  usage: VariableUsageHere | undefined;
  /** Whether a colour is built in: the site's code or the engine supplies it. */
  builtIn: (identity: string) => boolean;
  usedOnPage: ReadonlySet<string> | undefined;
}): { hidden: ReadonlySet<string>; marksBuiltIn: boolean } {
  const shown = builtInColoursShown(tokens);
  const colours = colourIdentities(groups);
  useHiddenReadAgain(shown, tokens, colours.filter(builtIn), usage?.readAgain);
  return {
    hidden: hiddenColours(colours, {
      shown,
      stateOf: identity => usageState(usage?.reachOf(identity)),
      builtIn,
      onPage: usedOnPage,
    }),
    marksBuiltIn: !shown,
  };
}

/**
 * The Colours tab's usage filter over the listed groups, leaving out the
 * built-in colours the site hides ({@link useHiddenOfView}), and those.
 */
export function useColoursOfView<
  G extends Parameters<typeof useColourFilter>[0]["shown"][number],
>({
  groups,
  builtIn,
  ...filter
}: Omit<Parameters<typeof useColourFilter<G>>[0], "hidden"> & {
  groups: Parameters<typeof colourIdentities>[0];
  builtIn: (identity: string) => boolean;
}): ReturnType<typeof useColourFilter<G>> & {
  hidden: ReadonlySet<string>;
  marksBuiltIn: boolean;
} {
  const { hidden, marksBuiltIn } = useHiddenOfView({
    tokens: filter.tokens,
    groups,
    usage: filter.usage,
    builtIn,
    usedOnPage: filter.usedOnPage,
  });
  return { ...useColourFilter({ ...filter, hidden }), hidden, marksBuiltIn };
}

/** The site's built-in colours setting, which ends the Colours tab. */
export function ColoursTabEnd({
  groups,
  ...setting
}: React.ComponentProps<typeof BuiltInColoursSetting> & {
  groups: readonly { readonly group: VariableGroup }[];
}): React.JSX.Element | null {
  if (!groups.some(group => group.group === "colours")) return null;
  return <BuiltInColoursSetting {...setting} />;
}

/** The identities of the colours the view lists. */
function colourIdentities(
  groups: readonly {
    readonly group: VariableGroup;
    readonly entries: readonly VariableEntry[];
  }[]
): string[] {
  return groups
    .filter(group => group.group === "colours")
    .flatMap(group => group.entries.map(entry => entry.row.identity));
}
