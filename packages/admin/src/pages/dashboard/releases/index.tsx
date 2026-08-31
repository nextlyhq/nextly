"use client";

/**
 * The releases page — what is going live, and when.
 *
 * A top-level page rather than a panel on a document: a release spans
 * collections and Singles, and there is no one document to hang it off. It is
 * also the only shape that answers "what ships on Friday?" without starting
 * from something that happens to be in it.
 *
 * @module pages/dashboard/releases
 */

import { useState } from "react";

import { CreateReleaseDialog } from "@admin/components/features/releases/CreateReleaseDialog";
import { ReleaseCalendar } from "@admin/components/features/releases/ReleaseCalendar";
import { ReleaseList } from "@admin/components/features/releases/ReleaseList";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Button } from "@admin/components/ui";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCan } from "@admin/hooks/useCan";
import { navigateTo } from "@admin/lib/navigation";

export default function ReleasesPage() {
  // The same authority the server checks, asked here so the button is not
  // offered to someone who would be refused. The refusal is deliberately
  // generic — `forbidden` ships one fixed sentence so a response cannot leak
  // the authority model — which makes the UI the only place a reason can be
  // given, and "do not offer it" the clearest reason there is.
  const canAssemble = useCan("create-content-releases");
  const [creating, setCreating] = useState(false);
  // TWO VIEWS OF ONE SET, not two pages. A list answers "what launches exist"
  // and a calendar answers "what is coming, and is anything colliding" — the
  // same releases, read for different questions, which is how every product
  // that ships this surface arranges it rather than as a separate feature.
  const [view, setView] = useState<"list" | "calendar">("list");

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Releases</h1>
            {/* Names the page's SUBJECT rather than one of its questions, so it
                stays true whether the list is empty, full of drafts, or showing
                a launch that already happened. */}
            <p className="mt-1 text-sm font-normal text-muted-foreground">
              Documents that go live together, at one moment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* A radiogroup rather than two buttons: these are mutually
                exclusive views of one thing, and that is what tells a screen
                reader the second choice replaces the first rather than doing
                something additional. */}
            <div
              role="radiogroup"
              aria-label="View releases as"
              className="flex items-center rounded-md border border-border p-0.5"
            >
              {(["list", "calendar"] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={view === option}
                  onClick={() => setView(option)}
                  className={[
                    "rounded px-3 py-1 text-sm capitalize transition-colors",
                    view === option
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {option}
                </button>
              ))}
            </div>
            {canAssemble ? (
              <Button onClick={() => setCreating(true)}>New release</Button>
            ) : null}
          </div>
        </div>

        {view === "calendar" ? (
          <ReleaseCalendar />
        ) : (
          <ReleaseList
            onCreate={canAssemble ? () => setCreating(true) : undefined}
          />
        )}

        {canAssemble ? (
          <CreateReleaseDialog
            open={creating}
            onOpenChange={setCreating}
            // Straight into the new release. It is empty, and the next thing to
            // do is put something in it — leaving the editor on a list where
            // one row just appeared makes them find it again to continue.
            onCreated={release =>
              navigateTo(buildRoute(ROUTES.RELEASES_DETAIL, { id: release.id }))
            }
          />
        ) : null}
      </PageContainer>
    </QueryErrorBoundary>
  );
}
