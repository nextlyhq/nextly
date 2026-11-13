"use client";

/**
 * What the Content overview says when the reader has no collection and no
 * Single to open, on any of its addresses: there is nothing here they can
 * open, and, to a reader who may build one, how to start.
 *
 * @module components/features/content-overview/ContentEmptyState
 */
import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { List, Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

export function ContentEmptyState({
  canBuild,
}: {
  /** Whether the reader may build a collection in the Schema Builder. */
  canBuild: boolean;
}): JSX.Element {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <List aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          No content you can open
        </h2>
        <p className="text-sm text-muted-foreground">
          {canBuild
            ? "There are no collections or Singles yet. Create a collection to start writing content."
            : "There are no collections or Singles you can open. Ask an administrator for access."}
        </p>
        {canBuild ? (
          <Button asChild className="mt-8">
            <Link href={ROUTES.BUILDER_COLLECTIONS_NEW}>
              <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
              Create a collection
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
