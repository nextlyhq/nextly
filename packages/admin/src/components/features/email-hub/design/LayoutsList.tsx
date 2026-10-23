"use client";

import { Alert, AlertDescription, Badge, Skeleton } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useMemo } from "react";

import { Link } from "@admin/components/ui/link";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";

import { compareGroups, ownerGroupOf } from "../messages/messages-model";
import { TemplateActionsMenu } from "../TemplateActionsMenu";
import { editRouteFor, useTemplateActions } from "../useTemplateActions";

/**
 * The layouts every email is wrapped in, and the partials they share, each
 * with who owns it and the actions the reader may take on it.
 */
export function LayoutsList(): JSX.Element {
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useEmailTemplates();
  const { actionsFor, canOpen, dialogs } = useTemplateActions();

  const layouts = useMemo(
    () =>
      templates
        .filter(record => record.kind !== "template")
        .sort(
          (a, b) =>
            compareGroups(ownerGroupOf(a.owner), ownerGroupOf(b.owner)) ||
            a.name.localeCompare(b.name)
        ),
    [templates]
  );

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? "Failed to load layouts. Please try again."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section aria-labelledby="email-layouts-heading" className="space-y-3">
      <div>
        <h2 id="email-layouts-heading" className="text-base font-semibold">
          Layouts
        </h2>
        <p className="text-sm text-muted-foreground">
          The frame each email is sent in, and the pieces layouts share.
        </p>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : layouts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No layouts yet.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {layouts.map(layout => {
            const actions = actionsFor(layout);
            return (
              <li key={layout.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {canOpen ? (
                      <Link
                        href={editRouteFor(layout)}
                        className="font-medium hover:underline"
                      >
                        {layout.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{layout.name}</span>
                    )}
                    <Badge variant="outline">
                      {layout.kind === "layout" ? "Layout" : "Partial"}
                    </Badge>
                    {layout.overridden && (
                      <Badge variant="outline">Customised</Badge>
                    )}
                    {!layout.isActive && <Badge variant="outline">Off</Badge>}
                  </div>
                  <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    {layout.slug} · {ownerGroupOf(layout.owner).label}
                  </div>
                </div>
                <TemplateActionsMenu name={layout.name} actions={actions} />
              </li>
            );
          })}
        </ul>
      )}
      {dialogs}
    </section>
  );
}
