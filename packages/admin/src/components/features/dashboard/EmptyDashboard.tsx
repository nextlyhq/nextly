"use client";

/**
 * The dashboard of a reader who can see no content yet.
 *
 * Drawn in place of the cards rather than as one more card among them: with
 * nothing to count, list or chart, every card is an empty frame, and a page of
 * empty frames says nothing about what to do next. This says one thing, chosen
 * from the setup steps the host reports -- already filtered there by what this
 * reader may do, so nothing here decides who may create what.
 *
 * It owns the demo-content offer's state (`useSeedStatus`) rather than leaving
 * it to the card that draws the offer, because the same instance has to choose
 * this body and run the seed: the mid-flight state lives in that instance, and
 * a second one would see the offer answered and switch bodies while the first
 * was still reporting how the seed went.
 *
 * @module components/features/dashboard/EmptyDashboard
 */

import { Button } from "@nextlyhq/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Database, FileText, Inbox, Plus } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ListEmptyState } from "@admin/components/ui/table/list-view/ListEmptyState";
import {
  useOnboardingSteps,
  type OnboardingStepId,
  type OnboardingStepState,
} from "@admin/hooks/queries/useOnboardingSteps";
import {
  isOfferedSeedStatus,
  useSeedStatus,
  type OfferedSeedStatus,
  type SeedStatus,
} from "@admin/hooks/queries/useSeedStatus";

import { ONBOARDING_STEP_PRESENTATION } from "./OnboardingChecklist";
import { SeedDemoContentCard } from "./SeedDemoContentCard";

/**
 * How long a clean success stays up before the dashboard takes over: the five
 * seconds the success eyebrow tells the reader to expect.
 */
const RELEASE_AFTER_MS = 5000;

export interface EmptyDashboardProps {
  /** Says a sentence through the grid's one live region. */
  announceStatus: (text: string) => void;
  /**
   * Keeps this state on screen, or lets it go.
   *
   * Seeding is what ends an empty install, so the host's next answer says there
   * is content while the outcome is still being reported. Held from the moment a
   * seed starts until the reader continues or skips, or a clean success has been
   * up long enough to read.
   */
  onHold: (holding: boolean) => void;
  /**
   * Puts focus somewhere that outlives this state. Called before an action
   * removes the control the reader used, so focus is not dropped on the page.
   */
  onLeave: () => void;
}

/** The steps this page can point a reader at. */
type PointedStep = Extract<OnboardingStepId, "collection" | "entry">;

/** What the page says. */
type Body =
  | { kind: "pending" }
  | { kind: "unavailable" }
  | { kind: "step"; step: PointedStep }
  | { kind: "seed"; status: OfferedSeedStatus }
  | { kind: "nothing" };

/** Whether the host offers this step to this reader, and it is still to do. */
function outstanding(
  steps: readonly OnboardingStepState[],
  id: PointedStep
): boolean {
  return steps.some(step => step.id === id && !step.complete);
}

/**
 * The one thing this page says, asked in order.
 *
 * A collection comes first because nothing else is possible without one. The
 * demo-content offer comes before the first entry because accepting it adds
 * entries, many at once. A reader offered neither step is told plainly that
 * there is nothing yet, with nothing to press: the steps arrive filtered by what
 * they may do, so an absent step is one this reader cannot take.
 *
 * `released` is a success the reader has already moved past. Its body is not
 * chosen again, so a Continue that lands before the host's next answer does not
 * draw the same message a second time.
 */
function bodyFor(
  onboarding: {
    steps: readonly OnboardingStepState[];
    isPending: boolean;
    isUnavailable: boolean;
  },
  seed: SeedStatus,
  released: boolean
): Body {
  if (onboarding.isPending) return { kind: "pending" };
  if (onboarding.isUnavailable) return { kind: "unavailable" };
  if (outstanding(onboarding.steps, "collection")) {
    return { kind: "step", step: "collection" };
  }
  // Unanswered, so neither the offer nor the entry step can be chosen yet
  // without one of them flashing past on the way to the other.
  if (seed.kind === "loading") return { kind: "pending" };
  if (isOfferedSeedStatus(seed) && !(seed.kind === "success" && released)) {
    return { kind: "seed", status: seed };
  }
  if (outstanding(onboarding.steps, "entry")) {
    return { kind: "step", step: "entry" };
  }
  return { kind: "nothing" };
}

/**
 * What the live region says as a seed moves, or nothing for a state that is not
 * news. Every outcome is said, because none of them moves focus: without these
 * a screen reader hears nothing between pressing Seed and the page changing.
 */
function seedSentence(status: SeedStatus): string | null {
  switch (status.kind) {
    case "seeding":
      return "Loading demo content.";
    case "success": {
      const count = status.result.warnings.length;
      if (count === 0) return "Demo content seeded.";
      return `Demo content seeded with ${count} ${count === 1 ? "warning" : "warnings"}.`;
    }
    case "error":
      return `Couldn't seed demo content: ${status.message}`;
    case "loading":
    case "hidden":
    case "idle":
      return null;
  }
}

/**
 * The words for each step this page can point at. The link and its label come
 * from the checklist's own map, so both surfaces send a reader to one place.
 */
const STEP_COPY: Record<
  PointedStep,
  { icon: ReactNode; title: string; description: string }
> = {
  collection: {
    icon: <Database aria-hidden className="h-5 w-5" />,
    title: "No collections yet",
    description:
      "Create your first collection to start organising your content.",
  },
  entry: {
    icon: <FileText aria-hidden className="h-5 w-5" />,
    title: "No content yet",
    description:
      "Your collections are ready. Add an entry and it will show up here.",
  },
};

function StepBody({ step }: { step: PointedStep }) {
  const { icon, title, description } = STEP_COPY[step];
  const { label, href } = ONBOARDING_STEP_PRESENTATION[step];
  return (
    <ListEmptyState
      icon={icon}
      title={title}
      description={description}
      action={
        href ? (
          <Button asChild>
            <Link href={href}>
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              {label}
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}

function EmptyBody({
  body,
  onSeed,
  onSkip,
  onContinue,
}: {
  body: Body;
  onSeed: () => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  switch (body.kind) {
    case "pending":
      // The size of what replaces it, so the page does not jump when the answer
      // lands. Hidden from assistive technology, which is told nothing until
      // there is something to say.
      return (
        <div
          aria-hidden
          data-testid="empty-dashboard-pending"
          className="h-48 animate-pulse rounded-lg bg-muted"
        />
      );
    case "unavailable":
      return (
        <ListEmptyState
          icon={<Inbox aria-hidden className="h-5 w-5" />}
          title="Nothing to show yet"
          description="Your next steps could not be loaded right now."
        />
      );
    case "step":
      return <StepBody step={body.step} />;
    case "seed":
      return (
        <SeedDemoContentCard
          status={body.status}
          onSeed={onSeed}
          onSkip={onSkip}
          onContinue={onContinue}
        />
      );
    case "nothing":
      return (
        <ListEmptyState
          icon={<Inbox aria-hidden className="h-5 w-5" />}
          title="Nothing here yet"
          description="Content you can see will appear here once it has been added."
        />
      );
  }
}

export function EmptyDashboard({
  announceStatus,
  onHold,
  onLeave,
}: EmptyDashboardProps) {
  const onboarding = useOnboardingSteps();
  const seed = useSeedStatus();
  const [released, setReleased] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const { status } = seed;
  const body = bodyFor(onboarding, status, released);
  const holding =
    status.kind === "seeding" ||
    status.kind === "error" ||
    (status.kind === "success" && !released);
  // A success with warnings waits for the reader: the warnings are the part
  // worth reading, and a timer would take them away mid-sentence.
  const releasesItself =
    status.kind === "success" &&
    !released &&
    status.result.warnings.length === 0;

  const sentence = seedSentence(status);
  useEffect(() => {
    if (sentence) announceStatus(sentence);
  }, [sentence, announceStatus]);

  // Reported on every change, including the first render, so a remount after an
  // interrupted hold lets go of a hold nothing is still reporting.
  useEffect(() => {
    onHold(holding);
  }, [holding, onHold]);

  // Only when focus is inside: moving a reader's focus from wherever they have
  // gone, on a timer, would be a relocation they did not ask for.
  const leaving = useCallback(() => {
    if (root.current?.contains(document.activeElement)) onLeave();
  }, [onLeave]);

  const release = useCallback(() => {
    leaving();
    setReleased(true);
  }, [leaving]);

  useEffect(() => {
    if (!releasesItself) return;
    const timer = setTimeout(release, RELEASE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [releasesItself, release]);

  const leavingThen = (action: () => void) => () => {
    leaving();
    action();
  };

  return (
    <div ref={root} className="col-span-full" data-testid="empty-dashboard">
      <EmptyBody
        body={body}
        onSeed={leavingThen(seed.startSeed)}
        onSkip={leavingThen(seed.skip)}
        onContinue={release}
      />
    </div>
  );
}
