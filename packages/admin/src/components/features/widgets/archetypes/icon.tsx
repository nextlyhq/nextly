/**
 * Resolving a Lucide icon NAME to a component, for anything a widget draws.
 *
 * Shared because two places need it — the card's own icon and an `actions`
 * shortcut's — and the lookup has two traps in it worth solving once.
 *
 * Resolved against `@admin/components/icons`, the curated barrel, NOT against
 * `lucide-react`. That barrel exists to keep the admin at roughly 20KB of icons
 * instead of the 400KB the full set costs, and importing the library here to
 * "resolve any name" would quietly undo it for every page that loads a widget.
 * A plugin naming an icon outside the barrel gets no icon, which is the same
 * answer it gets for a typo.
 *
 * @module components/features/widgets/archetypes/icon
 */

import type { ReactNode } from "react";

import * as Icons from "@admin/components/icons";

/**
 * The named icon, or nothing.
 *
 * By OWN property. The name arrives from a plugin's declaration, so it is an
 * arbitrary string, and a plain module namespace answers for everything on
 * `Object.prototype` as well as its own exports: `"constructor"`, `"toString"`
 * and `"valueOf"` are all functions, so a truthiness check would treat them as
 * components and React would be handed something that is not one. The same
 * reading the archetype renderer table had to be taught.
 *
 * An unknown name draws nothing rather than failing the card. An icon is
 * decoration on a widget whose title and body are the content, and a typo in a
 * decoration should not cost the card.
 */
export function resolveIconName(name: string | undefined): ReactNode {
  if (!name) return undefined;
  // `Object.hasOwn` IS the guard, and a `typeof === "function"` check beside it
  // is not a second one -- it is a bug. A Lucide icon is a `forwardRef`
  // component, which is an OBJECT, so that test rejected every real icon while
  // the own-property check was already excluding `constructor`, `toString` and
  // every other inherited name.
  if (!Object.hasOwn(Icons, name)) return undefined;
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[name];
  return Icon ? <Icon className="h-4 w-4" /> : undefined;
}
