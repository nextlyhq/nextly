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

import { PageHeader } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { CreateReleaseDialog } from "@admin/components/features/releases/CreateReleaseDialog";
import {
  ReleaseAttentionStrip,
  useAttentionStripKnown,
} from "@admin/components/features/releases/ReleaseAttentionStrip";
import { ReleaseBoard } from "@admin/components/features/releases/ReleaseBoard";
import { ReleaseCalendar } from "@admin/components/features/releases/ReleaseCalendar";
import {
  ReleaseBodyOutline,
  ReleaseList,
  releaseKindShown,
} from "@admin/components/features/releases/ReleaseList";
import { Plus } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared/breadcrumbs";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Button } from "@admin/components/ui";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { useCan } from "@admin/hooks/useCan";
import { navigateTo, setSearchParams } from "@admin/lib/navigation";
import type { ReleaseListTab } from "@admin/types/releases";

/** The page's views of one set of releases, in the switch's order. */
const RELEASE_VIEWS = ["list", "calendar", "board"] as const;

export default function ReleasesPage(): JSX.Element {
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
  //
  // The Board is the third: the list's tabs side by side, read-only (see
  // `ReleaseBoard`). Remembered as the other two are, for the page's life.
  const [view, setView] = useState<(typeof RELEASE_VIEWS)[number]>("list");
  // "Hide single documents" is turned on in the List's toolbar and holds for
  // every view, so it is kept here: the List is swapped out while the
  // Calendar or the Board is shown, and a switch it held would reset.
  const [hideSingles, setHideSingles] = useState(false);
  const kind = releaseKindShown(hideSingles);
  // From the Board, a full column's rest is its tab in the List.
  const showTab = (tab: ReleaseListTab) => {
    setSearchParams({ tab: tab === "upcoming" ? null : tab, reason: null });
    setView("list");
  };
  // Whether the attention strip is drawn is known only once its read answers.
  // Until then what stands under it is held as one outline, and the strip,
  // the tabs and the list are drawn together in its place: drawn at once and
  // then pushed down by a strip arriving above them, every part would move.
  // The list stays mounted meanwhile, hidden, so its own reads leave now.
  const stripKnown = useAttentionStripKnown();

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        {/* Where the page is, in the top bar, as on every other page. */}
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Releases" },
          ]}
        />
        {/* Names the page's SUBJECT rather than one of its questions, so it
                stays true whether the list is empty, full of drafts, or showing
                a launch that already happened. */}
        <PageHeader
          title="Releases"
          description="Documents that go live together, at one moment."
          actions={
            <>
              <div className="flex items-center gap-2">
                {/* Toggle BUTTONS, deliberately not a radiogroup. A radiogroup
                promises composite keyboard behaviour — one tab stop, arrows to
                move and select — and declaring one without providing it is
                worse than plain controls: it tells a keyboard user to press
                arrows that do nothing. `aria-pressed` says the same thing about
                state and promises only what these actually do. */}
                <div
                  role="group"
                  aria-label="View releases as"
                  className="flex items-center rounded-md border border-border p-0.5"
                >
                  {RELEASE_VIEWS.map(option => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={view === option}
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
                  <Button onClick={() => setCreating(true)}>
                    {/* The same affordance as "New" on every other list page. */}
                    <Plus className="size-4" aria-hidden />
                    New release
                  </Button>
                ) : null}
              </div>
            </>
          }
        />

        {/* Above both views: a stopped or overdue release needs acting on
            whichever way the page is being read. "View all" leads to the
            list's Needs attention tab, so it turns the page to the list. */}
        {stripKnown ? null : <ReleaseBodyOutline />}
        <div hidden={!stripKnown}>
          <ReleaseAttentionStrip onShowAll={() => setView("list")} />

          {view === "calendar" ? (
            <ReleaseCalendar kind={kind} />
          ) : view === "board" ? (
            // The Board reads every tab whole, under the single-document
            // filter only: the search belongs to the List's own toolbar.
            <ReleaseBoard onShowTab={showTab} kind={kind} />
          ) : (
            <ReleaseList
              onCreate={canAssemble ? () => setCreating(true) : undefined}
              hideSingles={hideSingles}
              onHideSinglesChange={setHideSingles}
            />
          )}
        </div>

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
