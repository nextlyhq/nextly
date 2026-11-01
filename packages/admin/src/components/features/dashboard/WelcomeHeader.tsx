"use client";

import { Button } from "@nextlyhq/ui";
import { useEffect, useState, type JSX } from "react";

import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useDashboardSummary } from "@admin/hooks/queries/useDashboardSummary";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import type { DashboardSummary } from "@admin/types/dashboard/summary";

import { useDashboardChrome } from "./header/dashboard-chrome";
import { EnvironmentBadge } from "./header/EnvironmentBadge";
import { Freshness } from "./header/Freshness";
import { NewSplitButton } from "./header/NewSplitButton";
import { ResumeSetupLink } from "./header/ResumeSetupLink";
import { SummaryLine } from "./header/SummaryLine";
import { useSetupResume } from "./setup/useSetupResume";

/**
 * The id of the dashboard's level-one heading.
 *
 * Exported so the widget grid can send focus here when a notice it showed
 * closes: the heading is the one landmark every state of the page draws, so a
 * reader whose focused element just went away lands at the top of what they
 * were reading rather than on `body`.
 */
export const DASHBOARD_HEADING_ID = "dashboard-heading";

/** The greeting for the reader's own hour, with their first name, or "Welcome" without one. */
export function greetingFor(
  name: string | null | undefined,
  now: Date
): string {
  const first = name?.trim().split(/\s+/)[0];
  if (!first) return "Welcome";
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${first}`;
}

/**
 * The summary as the line may word it: none while its latest read failed. A
 * read that fails after one that answered keeps the earlier answer, and its
 * counts, or its "all caught up", are no longer known to be true.
 */
function currentSummary(
  read: ReturnType<typeof useDashboardSummary>
): DashboardSummary | undefined {
  return read.isError ? undefined : read.data;
}

/** The time the header words itself against, moved on each minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The dashboard's header, part of the page rather than a widget: a greeting,
 * the project's name (the page's one level-one heading) with the environment
 * badge the site config names, the live summary (ending with "Resume setup"
 * while the reader's dismissed setup card can come back), the freshness line
 * when the data is old, and Customize.
 *
 * It renders in every state, from first paint: the heading is where a
 * screen-reader or keyboard user lands when they jump by heading, and every
 * card title (an `h2`) sits under it in the outline. The project's name needs
 * no request, so the heading is whole at once; the greeting waits for the
 * signed-in user behind a placeholder of its own.
 *
 * Customize is drawn only for a reader the grid has an arrangement for, and
 * not while customise mode is open, when the mode's own bar holds the controls.
 */
export function WelcomeHeader(): JSX.Element {
  const { user, isLoading: userLoading } = useDashboardUser();
  const appName = useAppName();
  const summary = useDashboardSummary();
  const chrome = useDashboardChrome();
  const now = useMinuteClock();
  const setupResume = useSetupResume();

  return (
    <header
      className="flex flex-wrap items-end justify-between gap-3 px-0.5 pt-1 pb-4"
      data-testid="dashboard-header"
    >
      <div className="min-w-0">
        <p
          className="text-xs text-muted-foreground"
          data-testid="dashboard-greeting"
        >
          {userLoading ? (
            // A placeholder the greeting's height, hidden from assistive tech.
            <span
              aria-hidden="true"
              className="inline-block h-3 w-28 rounded bg-primary/5 align-middle animate-pulse motion-reduce:animate-none"
            />
          ) : (
            greetingFor(user?.name, now)
          )}
        </p>
        <div className="flex items-center gap-2">
          <h1
            id={DASHBOARD_HEADING_ID}
            // Focusable only PROGRAMMATICALLY (`-1` keeps it out of the Tab
            // sequence), so focus can be returned here when the element holding it
            // is taken off the page.
            tabIndex={-1}
            // No outline when focus is sent here: a heading is a place to land,
            // not a control, and a ring around it reads as something to press.
            className="text-xl font-semibold tracking-[-0.01em] text-foreground leading-tight focus:outline-none"
          >
            {appName}
          </h1>
          {/* Beside the heading, not in it: the heading's name is the project's. */}
          {summary.data?.environment ? (
            <EnvironmentBadge environment={summary.data.environment} />
          ) : null}
        </div>
        {/* The summary's one line is held from the first paint (its margin
            and a line of its text), so its arrival moves nothing: neither the
            header's actions, which sit at its foot, nor the cards below. */}
        <div
          className="flow-root min-h-[calc(1lh_+_3px)] text-[12.5px]"
          data-testid="dashboard-summary-slot"
        >
          <SummaryLine
            summary={currentSummary(summary)}
            cards={chrome?.cards ?? {}}
            now={now}
            trailing={
              setupResume.resumable ? (
                <ResumeSetupLink resume={setupResume} />
              ) : null
            }
          />
        </div>
        <Freshness
          oldestAnswerAt={chrome?.oldestAnswerAt ?? null}
          now={now}
          onRefresh={() => chrome?.refresh()}
        />
      </div>
      <HeaderActions chrome={chrome} />
    </header>
  );
}

/**
 * The header's actions, Customize then New, as the approved design places
 * them; both give way to customise mode's own bar. The group may narrow to the
 * header's width (New's label then cuts short), so it never widens a phone's
 * page. What the grid's chrome says decides whether Customize is offered, held
 * or absent.
 */
function HeaderActions({
  chrome,
}: {
  chrome: ReturnType<typeof useDashboardChrome>;
}): JSX.Element {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      {chrome === null || chrome.awaitingArrangement ? (
        // Until the grid knows whether this reader may customise (it has
        // not published, or their arrangement is still on its way),
        // Customize's place is held, unseen and out of reach, so New is
        // drawn from the first paint where it stays instead of moving over
        // when Customize arrives.
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-hidden="true"
          tabIndex={-1}
          inert
          className="invisible"
          data-testid="dashboard-edit-reserve"
        >
          Customize
        </Button>
      ) : chrome.customizable && !chrome.editing ? (
        <div className="flex gap-2" data-testid="dashboard-edit-offer">
          <Button
            ref={chrome.customizeRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={chrome.begin}
            // 🔴 Beginning an edit is not itself a write, and it still has to
            // wait for one: the draft is seeded with the version it will be
            // saved against, so one opened while a write settles would carry a
            // guard about to go stale.
            disabled={chrome.writing}
            data-testid="dashboard-edit-begin"
          >
            {/* "Customize", the word every message about this mode uses: the
              unreadable-layout notice tells the reader to save "from
              Customize", so the control has to be called that. */}
            Customize
          </Button>
        </div>
      ) : null}
      {chrome?.editing ? null : <NewSplitButton />}
    </div>
  );
}
