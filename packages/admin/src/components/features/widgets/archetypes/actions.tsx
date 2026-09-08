/**
 * The `actions` archetype: a short column of shortcuts.
 *
 * Drawn from the DECLARATION, with no query behind it. Core's own validator
 * refuses a query on this archetype, so no request is ever made for one of
 * these cards and no slot ever arrives — which is why it is a declared body
 * rather than one that would have to ignore a `WidgetResult`.
 *
 * Each item is permission-gated ON ITS OWN. A shortcut to something the reader
 * may not do is worse than no shortcut: it advertises a capability, costs a
 * click, and answers with a refusal screen. That is a different question from
 * the card's own `requiredPermission`, which decides whether the widget appears
 * at all — a card of five shortcuts where the reader may use two should show
 * two, not disappear.
 *
 * @module components/features/widgets/archetypes/actions
 */

import { Link } from "@admin/components/ui/link";

import { resolveIconName } from "./icon";
import type { DeclaredBody } from "./types";

/**
 * How many shortcuts a card shows before it stops being a shortcut.
 *
 * The rest are counted rather than drawn, and never refused: this runs in the
 * browser on a declaration boot already accepted, so refusing here would blank
 * a card over a length -- and refusing at BOOT would abort plugin resolution
 * over one oversized card, which is the failure shape this system has
 * deliberately removed elsewhere. One badly-sized widget costs its own card.
 */
const MAX_ACTIONS = 6;

/**
 * NO `accepts` for this archetype, deliberately.
 *
 * A declaration carrying no shortcuts is already refused where it is written --
 * the type requires them and boot refuses a contribution without them -- so by
 * the time a widget reaches the browser its list was non-empty. What CAN empty
 * it here is the per-item permission filter in `resolve-widgets`, and that is
 * not a malformed widget: it is a reader who may use none of the shortcuts, and
 * the card says so below.
 *
 * An `accepts` that re-checked the length could not tell those apart, because
 * it runs on the FILTERED list. It reported "declares no shortcuts" for a
 * perfectly good widget and made the empty state under it unreachable.
 */
export const actionsBody: DeclaredBody = definition => {
  const declared = definition.actions ?? [];

  // Already gated per item by `resolve-widgets`, which is the one place holding
  // `hasPermission` and the same place the CARD's own permission is judged.
  // Filtering here would need a second copy of that predicate threaded through
  // the body signature, and two gates for one question drift.
  //
  // A reader who may use none of them gets the empty state rather than an empty
  // card: the widget is legitimately present -- its own `requiredPermission`
  // let it through -- and saying so is more useful than a titled card with
  // nothing under it.
  const visible = declared.slice(0, MAX_ACTIONS);

  if (visible.length === 0) {
    return {
      ok: true,
      node: (
        <p
          data-testid="widget-actions-empty"
          className="text-sm text-muted-foreground"
        >
          Nothing here for you.
        </p>
      ),
    };
  }

  const hidden = declared.length - visible.length;

  return {
    ok: true,
    node: (
      <div className="flex flex-col gap-1">
        <ul data-testid="widget-actions" className="flex flex-col gap-1">
          {visible.map(action => (
            <li key={`${action.label}:${action.href}`}>
              <Link
                href={action.href}
                data-testid="widget-action"
                // An external destination opens in a new tab and says so, both
                // for a screen reader and for the browser's own safety: a
                // `noopener` link cannot reach back into this window.
                {...(action.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="flex items-center truncate rounded px-1 py-0.5 text-sm text-primary hover:underline focus-visible:underline"
              >
                {action.icon && (
                  <span aria-hidden="true" className="mr-1.5 inline-flex">
                    {resolveIconName(action.icon)}
                  </span>
                )}
                {action.label}
                {action.external && (
                  <span className="sr-only"> (opens in a new tab)</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          // Counted rather than silently dropped. A card that shows six of
          // nine without saying so reads as the whole list, and the author has
          // no way to notice their tenth shortcut never appeared.
          <p
            data-testid="widget-actions-overflow"
            className="px-1 text-xs text-muted-foreground"
          >
            {hidden} more not shown.
          </p>
        )}
      </div>
    ),
  };
};
