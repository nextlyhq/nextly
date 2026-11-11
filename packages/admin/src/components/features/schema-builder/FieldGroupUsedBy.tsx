"use client";

/**
 * In a field group's own editor: which collections, Singles and field groups
 * use it, each linked to its own editor, and that a change here reaches all
 * of them.
 *
 * Said while it is read, and when it cannot be read, rather than left blank:
 * a blank would read as "used nowhere", which is the one answer that makes a
 * change look safe.
 */
import type { JSX } from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useFieldGroupUsedBy,
  type FieldGroupPlacement,
} from "@admin/hooks/useFieldGroupUsedBy";

/** What each kind of holder is called, and where its editor is. */
const HOLDERS: Record<
  FieldGroupPlacement["entityType"],
  { noun: string; route: string }
> = {
  collection: { noun: "Collection", route: ROUTES.BUILDER_COLLECTIONS_EDIT },
  single: { noun: "Single", route: ROUTES.BUILDER_SINGLES_EDIT },
  fieldGroup: { noun: "Field group", route: ROUTES.BUILDER_FIELD_GROUPS_EDIT },
};

/** The placements by holder, in the order first met, each with its fields. */
function byHolder(
  placements: readonly FieldGroupPlacement[]
): { holder: FieldGroupPlacement; paths: string[] }[] {
  const groups = new Map<
    string,
    { holder: FieldGroupPlacement; paths: string[] }
  >();
  for (const placement of placements) {
    const key = `${placement.entityType}:${placement.entitySlug}`;
    const group = groups.get(key) ?? { holder: placement, paths: [] };
    group.paths.push(placement.fieldPath);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The words for the state, or for the list's head. */
function summary(
  placements: readonly FieldGroupPlacement[] | undefined,
  failed: boolean
): string {
  if (failed) {
    return "Where this field group is used could not be read, so it is not known what a change here reaches.";
  }
  if (!placements) return "Finding where this field group is used…";
  if (placements.length === 0) {
    return "This field group is not used anywhere yet.";
  }
  const holders = byHolder(placements).length;
  return `Used by ${holders} ${holders === 1 ? "place" : "places"}. A change here reaches all of them.`;
}

export function FieldGroupUsedBy({ slug }: { slug: string }): JSX.Element {
  const query = useFieldGroupUsedBy(slug);
  // Any failed read, a refresh included, leaves the answer unknown. An earlier
  // answer kept past a failed refresh is not shown as current: a kept empty
  // list would say "used nowhere" after a use was added.
  const failed = query.isError;
  const placements = failed ? undefined : query.data;
  return (
    <section
      aria-label="Where this field group is used"
      className="mb-4 rounded-md border border-border px-4 py-3 text-sm"
    >
      <p role="status">{summary(placements, failed)}</p>
      {placements && placements.length > 0 && (
        <ul className="mt-2 space-y-1">
          {byHolder(placements).map(({ holder, paths }) => {
            const { noun, route } = HOLDERS[holder.entityType];
            return (
              <li key={`${holder.entityType}:${holder.entitySlug}`}>
                {noun}{" "}
                <Link
                  href={buildRoute(route, { slug: holder.entitySlug })}
                  className="font-medium underline underline-offset-2"
                >
                  {holder.entitySlug}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  ({paths.length === 1 ? "field" : "fields"}{" "}
                  {paths.map(path => (
                    <code key={path} className="mx-0.5">
                      {path}
                    </code>
                  ))}
                  )
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
