/**
 * Moving between the shell's regions by keyboard: F6 and Shift+F6 cycle them,
 * claimed by one shell at a time, the sides shortcut, and Escape from a
 * separator back to its region.
 *
 * @module shell-region-cycling
 */
import { useShortcuts } from "@nextlyhq/ui";
import * as React from "react";

import { isHTMLElement } from "./dom-kind";

/**
 * The regions F6 cycles between, in the order a sighted user reads them.
 *
 * A shell of this size is unusable by keyboard without region navigation: an
 * author who tabs out of the inspector should not traverse every control in the
 * canvas to reach the rail. F6 is the platform convention for exactly this.
 *
 * The top bar comes first: it holds the editor's own controls (exit, undo and
 * redo, the devices, the zoom, the side toggles), and it is where a reader's
 * eye starts.
 */
const REGIONS = ["header", "rail", "panel", "canvas", "inspector"] as const;
export type Region = (typeof REGIONS)[number];

/**
 * How many shells are ACTIVE right now — mounted and wide enough to be used.
 *
 * Read only to decide whether "focus is nowhere in particular" identifies a
 * shell unambiguously. With one usable editor on the page it does; with several
 * it does not, and the tie has to be declined rather than won by whichever
 * registered last.
 *
 * Active rather than merely mounted, and that distinction only became
 * observable once each shell measured its OWN container: siblings in columns of
 * different widths can now disagree about whether they fit, so a form can hold
 * one usable editor beside several showing their narrow notices. Counting every
 * mount there makes the one editor that CAN answer decline, because it sees
 * more than one — and the others decline too, since their binding is disabled.
 * F6 would reach nothing at all. A shell behind its notice is not a candidate
 * for the key, so it is not part of the ambiguity either.
 */
let activeShells = 0;

function useActiveShellCount(active: boolean): () => number {
  React.useEffect(() => {
    if (!active) return;
    activeShells += 1;
    return () => {
      activeShells -= 1;
    };
  }, [active]);
  return () => activeShells;
}

/**
 * Whether THIS shell should act on F6 right now.
 *
 * The binding is registered on the document, so on a page holding a shell
 * beside other controls — the field mount, embedded in an entry form — every
 * shell sees every press. Eligibility therefore cannot come from viewport
 * state alone: with several page-builder fields in one form, all of them were
 * eligible at once and the most recently registered answered, which moved
 * focus into an editor the author was not in.
 *
 * Ownership is asked of the shell ROOT, not of the regions. The two are
 * different questions and only look like one: the root answers "is the author
 * inside this editor", while the region list answers "where can cycling land".
 * The chrome header — the exit button and whatever the host puts in the top
 * bar — is inside the editor and inside no region, so asking the regions
 * rejected the shell whenever focus was on one of those controls and left F6
 * doing nothing from the very chrome it belongs to.
 *
 * The `document.body` case is what keeps the key working from a cold page: the
 * full Edit view owns its page and nothing inside it has focus yet, and
 * refusing there would make F6 look broken until focus happened to land
 * somewhere it recognised. It is allowed only while this is the sole shell,
 * because with more than one the press names none of them.
 */
function shellClaimsRegionCycling(
  root: HTMLElement | null,
  shellCount: number
): boolean {
  // The host document's own reading, deliberately not the focused node inside
  // a frame: focus inside a same-origin iframe reads here as the iframe, which
  // the shell contains, while the node inside it belongs to another document
  // that no element here contains.
  const active = document.activeElement;
  if (root?.contains(active)) return true;
  // `null` as well as `body`: a document that has never been clicked reports
  // no active element at all in some engines, which is the same "nowhere".
  const nowhere = active === null || active === document.body;
  return nowhere && shellCount === 1;
}

/**
 * mod+backslash, hiding or showing both sides of the editor.
 *
 * Read through a ref so the binding runs the current toggle, which closes over
 * this render's panels. Never while typing (a backslash is text there), and
 * only for the shell the author is in, by the same check F6 uses.
 */
export function useSidesShortcut(
  toggle: React.RefObject<() => void>,
  enabled: boolean,
  claims: () => boolean
): void {
  const latest = React.useRef({ enabled, claims });
  latest.current = { enabled, claims };
  useShortcuts(
    [
      {
        keys: "mod+\\",
        description: "Hide or show the side panels",
        whenTyping: false,
        when: () => latest.current.enabled && latest.current.claims(),
        run: () => toggle.current(),
      },
    ],
    { name: "Builder side panels" }
  );
}

/**
 * F6 region cycling, registered with the shared shortcut manager.
 *
 * Through the manager rather than a private key listener, because two
 * independent key layers is how "Escape navigates out of the editor while a drag
 * owns it" happens — the failure the manager exists to prevent.
 */
export function useRegionCycling(
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>,
  rootRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
): () => boolean {
  const shellCount = useActiveShellCount(enabled);
  // Read through a ref so the binding's `when` sees the CURRENT answer. The
  // manager checks it at press time, and a value captured when the binding was
  // registered would keep reporting whatever was true then.
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;

  useShortcuts(
    [
      {
        keys: "F6",
        // Off while the shell is hidden behind the narrow-viewport notice. The
        // subtree stays mounted there to preserve the caller's slots, which
        // leaves this binding registered over regions that are all `inert`:
        // pressing F6 on the notice consumed the key, focused nothing, and —
        // where the host shares the shortcut manager — took the keystroke from
        // whatever binding of its own would otherwise have handled it.
        //
        // `when` rather than skipping registration, because it is the
        // manager's own way of saying "not right now": a binding whose
        // condition is false is passed over and the key goes on to the next
        // layer, which is exactly the behaviour the host needs back.
        //
        // Focus is consulted for the same reason it is passed on: a shell the
        // author is not in should let the key reach whatever they ARE in.
        when: () =>
          enabledRef.current &&
          shellClaimsRegionCycling(rootRef.current, shellCount()),
        description: "Move to the next area of the editor",
        // The manager's default asks whether the FIRST chord carries a modifier
        // or is Escape, and answers no for a bare function key — so F6 would be
        // held back by any focused text field. That default is right for the
        // letter keys it was written for and backwards here: moving between
        // areas of the editor is the one thing an author needs MOST while a
        // caption or a field has focus, because it is how they get back out
        // without reaching for the mouse.
        whenTyping: true,
        run: () => {
          focusNextRegion(regionRefs.current);
        },
      },
    ],
    { name: "Builder shell" }
  );
  // The same question for every key this shell answers on behalf of the
  // whole editor: whether the author is in THIS shell, so a second shell
  // sharing the shortcut manager does not take the keystroke.
  return () => shellClaimsRegionCycling(rootRef.current, shellCount());
}

/**
 * Move focus to the next rendered region, wrapping around.
 *
 * A named function rather than the body of the binding, because TWO paths have
 * to perform this and they must not be two implementations of it — see
 * `useSeparatorRegionEscape` for why the second exists.
 */
function focusNextRegion(map: Record<Region, HTMLElement | null> | null): void {
  if (!map) return;
  // Only regions that are actually rendered. The left panel is absent whenever
  // the rail has nothing open, and cycling the static list would land on it,
  // focus nothing, and leave the key looking broken for every press after the
  // first.
  const present = REGIONS.filter(region => map[region] !== null);
  if (present.length === 0) return;

  // The host's own reading, for the reason `shellClaimsRegionCycling` gives.
  const active = document.activeElement;
  const currentIndex = present.findIndex(region =>
    map[region]?.contains(active)
  );
  // From outside any region, F6 enters the first rather than doing nothing —
  // otherwise the key appears broken until focus happens to land somewhere it
  // recognises.
  const next = present[(currentIndex + 1) % present.length];
  if (next !== undefined) map[next]?.focus();
}

/**
 * Let F6 escape a focused drag handle.
 *
 * The separators run their own key listener, and it claims F6: it cycles
 * between separators and calls `preventDefault()`. The shared shortcut manager
 * deliberately skips an event that has already been prevented — two layers both
 * acting on one keystroke is the failure it exists to stop — so the shell's
 * region binding never ran. In the default topology there is exactly ONE
 * separator, so F6 from a handle re-focused that same handle for ever, which is
 * the state an author lands in immediately after resizing anything.
 *
 * Handled in the CAPTURE phase on the shell root, which is the only place that
 * runs before the separator's own listener at the target. Propagation is stopped
 * so the manager does not then cycle a second time on the way back up.
 *
 * The region binding stays registered: it is what handles F6 from outside this
 * subtree, and what puts the shortcut in front of anything that lists them.
 */
export function useSeparatorRegionEscape(
  regionRefs: React.RefObject<Record<Region, HTMLElement | null>>,
  enabled: boolean
): (event: React.KeyboardEvent<HTMLElement>) => void {
  return React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "F6" || !enabled) return;
      // Only from a separator. Everywhere else the manager is the right owner,
      // and intercepting here would take the key from a host binding that has
      // every right to it.
      // By node kind rather than `instanceof HTMLElement`, which answers only
      // for elements this window built.
      const target = event.target;
      if (
        !isHTMLElement(target) ||
        target.getAttribute("role") !== "separator"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      focusNextRegion(regionRefs.current);
    },
    [regionRefs, enabled]
  );
}
