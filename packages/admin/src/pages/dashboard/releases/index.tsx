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
          {canAssemble ? (
            <Button onClick={() => setCreating(true)}>New release</Button>
          ) : null}
        </div>

        <ReleaseList
          onCreate={canAssemble ? () => setCreating(true) : undefined}
        />

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
