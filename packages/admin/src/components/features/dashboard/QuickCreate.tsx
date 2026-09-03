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
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCollections } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

/**
 * How many shortcuts are drawn before the rest are counted.
 *
 * The same budget the `actions` archetype uses, for the same reason: past a
 * handful this stops being a shortcut and becomes a second navigation menu,
 * which the sidebar already is. The surplus is reachable there.
 */
const MAX_SHORTCUTS = 6;

export function QuickCreate() {
  // 🔴 The SERVER's list, not the whole registry. This is the same query the
  // sidebar reads, and it is already filtered to what this reader may see — so
  // a collection they are not allowed to know exists is absent before any
  // permission check here runs, rather than being drawn and then hidden.
  const { data, isLoading } = useCollections({
    pagination: { page: 0, pageSize: 100 },
  });
  const { hasPermission } = useCurrentUserPermissions();

  const creatable = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter(collection =>
      hasPermission(`create-${collection.name}`)
    );
  }, [data?.items, hasPermission]);

  // Nothing at all while the list is in flight. A card that drew its empty
  // state first and then filled in would tell the reader they may create
  // nothing, which is a claim rather than a delay.
  if (isLoading) return null;

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

  const shown = creatable.slice(0, MAX_SHORTCUTS);
  const hidden = creatable.length - shown.length;

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
            {/* 🔴 The author's declared singular, then the display label, then
                the slug -- the same order `useEntryForm` resolves, so the
                button and the form it opens name the entity identically.
                Written out rather than shared because the admin currently
                answers this question in four places that disagree: the sidebar
                honours `labels.plural`, the entry list ignores `labels`
                entirely. Matching the most correct of them adds no fifth
                variant; converging them is its own change. */}
            <span>
              New{" "}
              {collection.labels?.singular ||
                collection.label ||
                collection.name}
            </span>
          </Link>
        ))}
      </div>
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          {hidden} more in the sidebar.
        </p>
      )}
    </div>
  );
}
