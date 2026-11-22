/**
 * The breakpoints writer: a new set of the site's breakpoints stored, refused
 * where it would empty a set the site's configuration defines.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/site-style-breakpoints
 */
import type { BreakpointSet } from "@nextlyhq/blocks-engine";
import { authoredBreakpoints } from "@nextlyhq/builder/shell";
import { useCallback } from "react";

import type { SiteStyleData } from "../../site-style";
import { useSaveSiteStyle } from "../site-style-client";

/**
 * Writing the site's breakpoints, for the manager in the top bar.
 *
 * A hook rather than a callback inside the editor, because that component is
 * already the largest branch point on this surface and every decision folded
 * into it is one more path through the whole thing. What it needs from here is
 * one stable function.
 *
 * Section-scoped, so this sends the breakpoints and nothing else — the other
 * three fields of the record are owned by other studios and are not read here in
 * order to write this one.
 */
export function useBreakpointWriter(
  configSiteStyle: SiteStyleData | undefined
): (next: BreakpointSet) => Promise<string | undefined> {
  const { save: saveSiteStyle } = useSaveSiteStyle();
  /*
   * Whether the HOST states breakpoints in its config, which is what makes an
   * empty stored set unrepresentable. Read from the config tier rather than from
   * the merged value, because the merged one cannot tell a stored set from a
   * defaulted one — which is the ambiguity being guarded.
   *
   * Through the SAME base filter the manager uses. A config carrying only the
   * built-in `{ id: "base" }` row states no authored breakpoint, so counting it
   * refuses the one save that returns such a site to its base-only state — and
   * tells the author to remove a config row the manager deliberately hides as
   * built in. Three surfaces now ask this question and all three ask it once.
   */
  const configuredAuthored = authoredBreakpoints(configSiteStyle?.breakpoints);
  const configured =
    configuredAuthored.viewport.length > 0 ||
    configuredAuthored.container.length > 0;

  return useCallback(
    async (next: BreakpointSet): Promise<string | undefined> => {
      /*
       * An empty set is not storable as an intention while the host states
       * defaults, so it is refused rather than reported as saved.
       *
       * `resolveSiteStyle` layers the stored record over the host's config and
       * decides "was anything stored" with `hasBreakpoints`, which is
       * `viewport.length > 0 || container.length > 0`. So writing
       * `{ viewport: [], container: [] }` succeeds, reads back as NOTHING
       * STORED, and the config defaults return — the author removes every row,
       * is told it saved, and watches them reappear.
       *
       * Refusing says what happened and where the remaining breakpoints come
       * from, which is the one thing the author cannot see from this screen.
       * Representing "explicitly none" would take a stored-format change, and
       * that is not a decision this callback should make silently.
       */
      const emptied = next.viewport.length === 0 && next.container.length === 0;
      if (emptied && configured) {
        return "Your site's configuration defines these breakpoints, so removing them all here would restore them. Remove them from the config instead.";
      }
      const result = await saveSiteStyle("breakpoints", next);
      if (result.saved) return undefined;
      const reasons = Object.values(result.issues);
      // `issues` can be empty on a refusal the transport could not describe.
      // Answering `undefined` there would report a save that did not happen,
      // which is the one outcome that must never be silent.
      return reasons.length > 0
        ? reasons.join(" ")
        : "These breakpoints could not be saved.";
    },
    [saveSiteStyle, configured]
  );
}
