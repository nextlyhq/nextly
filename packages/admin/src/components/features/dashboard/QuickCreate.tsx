"use client";
/**
 * "New Post", "New Page": one click from the dashboard to an empty entry form.
 *
 * ## Why a component rather than a declared `actions` widget
 *
 * The shortcuts depend on the READER, and a declaration cannot. Which
 * collections exist changes while the process runs — the Schema Builder makes
 * one without a restart — and which of them a given reader may create in is a
 * second, per-caller question on top of that. A widget declared at boot
 * describes neither.
 *
 * The `actions` archetype gates each item on `requiredPermission`, which
 * `resolve-widgets` filters against the flat permission list. That list is the
 * wrong instrument for this question: a collection's create rule can live in
 * its code-defined `access.create`, which no flat slug expresses. So the
 * shortcuts here are built from the collection list the SERVER already
 * filtered, and narrowed again by the create grant the client can see.
 *
 * ## What that gate does and does not promise
 *
 * 🔴 Neither half is a security boundary and this card must never be read as
 * one. The create endpoint runs `checkCollectionAccess(slug, "create", ...)`
 * whatever is drawn here, so a shortcut this card shows in error costs a click
 * and a refusal screen rather than an entry nobody was allowed to make.
 *
 * What the two gates buy is that the common cases are right: the server's list
 * removes collections the reader cannot see at all, and `create-<slug>` removes
 * the ones plain RBAC denies. What neither sees is a create rule expressed only
 * in code — a reader that rule refuses is still offered the shortcut. Closing
 * that needs a card whose BODY is filtered server-side, which nothing in the
 * widget model does yet, and it is not worth building for one card.
 *
 * @module components/features/dashboard/QuickCreate
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import { Plus } from "lucide-react";
import type { JSX } from "react";
import { useMemo } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollections } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { collectionSingularLabel } from "@admin/lib/collection-label";

import { useCardTier } from "../widgets/frame/tier";

import { keptOffDashboard } from "./kept-off-dashboard";

/**
 * How many shortcuts are drawn before the rest are counted.
 *
 * The same budget the `actions` archetype uses, for the same reason: past a
 * handful this stops being a shortcut and becomes a second navigation menu,
 * which the sidebar already is. The surplus is reachable there.
 */
/**
 * The shortcuts the card offers at each tier; the rest are a menu away. Past a handful a row of
 * shortcuts stops being one and becomes a second navigation menu, which the sidebar already is.
 */
const SHORTCUTS_DRAWN: Readonly<Record<SizeTier, number>> = Object.freeze({
  small: 2,
  medium: 3,
  large: 6,
});

/**
 * How many collections are asked for.
 *
 * The card needs the first few CREATABLE ones, and the server cannot filter on
 * that, so it reads a page and narrows it here. A page rather than every
 * collection because this is a shortcut card on a dashboard, not a directory —
 * and the empty state refuses to speak when the page was truncated, so the
 * bound costs a missing shortcut rather than a false claim.
 */
const COLLECTION_PAGE_SIZE = 100;

export function QuickCreate(): JSX.Element | null {
  // 🔴 The SERVER's list, not the whole registry. This is the same query the
  // sidebar reads, and it is already filtered to what this reader may see — so
  // a collection they are not allowed to know exists is absent before any
  // permission check here runs, rather than being drawn and then hidden.
  const {
    data,
    isLoading: collectionsLoading,
    error: collectionsError,
  } = useCollections({
    pagination: { page: 0, pageSize: COLLECTION_PAGE_SIZE },
  });
  const {
    hasPermission,
    isLoading: permissionsLoading,
    error: permissionsError,
  } = useCurrentUserPermissions();
  const tier = useCardTier();

  const creatable = useMemo(() => {
    const items = data?.items ?? [];
    // A collection kept off the dashboard (internal, or hidden from the navigation) is never a
    // shortcut here, whatever the reader may create in it.
    return items.filter(
      collection =>
        !keptOffDashboard(collection) &&
        hasPermission(`create-${collection.name}`)
    );
  }, [data?.items, hasPermission]);

  // 🔴 BOTH requests, and a failure of either. `hasPermission` answers from an
  // empty set until `/me/permissions` lands, so a collection list that resolves
  // first filters every row out and the card says the reader may create
  // nothing — for the whole of that interval, and permanently if either request
  // fails. Absence is the honest answer until both have arrived, because a
  // claim about what someone may do cannot be made from an answer that has not
  // come back.
  if (collectionsLoading || permissionsLoading) return null;
  if (collectionsError || permissionsError) return null;

  // 🔴 A truncated list cannot support the empty claim either. The page holds
  // the first `COLLECTION_PAGE_SIZE` collections, so an install with more than
  // that may have every creatable one beyond the boundary — and "you may create
  // nothing" would then be false rather than merely incomplete. Saying nothing
  // is wrong in a way the reader can recover from; saying the wrong thing is
  // not.
  const truncated = data?.meta?.hasNext === true;
  if (creatable.length === 0 && truncated) return null;

  if (creatable.length === 0) {
    return (
      <p
        data-testid="quick-create-empty"
        className="text-sm text-muted-foreground"
      >
        Nothing here for you to create.
      </p>
    );
  }

  // Medium until the card has measured itself, which it does before its first paint.
  const shown = creatable.slice(0, SHORTCUTS_DRAWN[tier ?? "medium"]);
  const rest = creatable.slice(shown.length);

  return (
    <div className="flex flex-col gap-2" data-testid="quick-create">
      <div className="flex flex-wrap gap-2">
        {shown.map(collection => (
          <Link
            key={collection.name}
            href={buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
              slug: collection.name,
            })}
            data-testid={`quick-create-${collection.name}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:bg-accent"
          >
            <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
            {/* The SHARED resolver, which the entry form asks too, so the
                button and the page it opens name the entity identically. */}
            <span>New {collectionSingularLabel(collection)}</span>
          </Link>
        ))}
      </div>
      {/* Located, not only counted: the menu lists the very collections this card read, so
          every one the reader may create in is a click away. The sidebar is not named as the
          way there, since it reads its own page of collections. */}
      {rest.length > 0 && <MoreToCreate collections={rest} />}
    </div>
  );
}

/** What the More menu needs of a collection: its name for the route, and its labels. */
type CreatableCollection = Parameters<typeof collectionSingularLabel>[0] & {
  name: string;
};

/** The collections past the tier's shortcuts, in a menu, each a click from its create form. */
function MoreToCreate({
  collections,
}: {
  collections: readonly CreatableCollection[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${collections.length} more collections to create`}
          className="inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {collections.length} more
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {collections.map(collection => (
          <DropdownMenuItem key={collection.name} asChild>
            <Link
              href={buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
                slug: collection.name,
              })}
              data-testid={`quick-create-more-${collection.name}`}
            >
              New {collectionSingularLabel(collection)}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
