/**
 * The setup steps still outstanding, drawn from the host's answer.
 *
 * Two things moved out of this card and neither is a detail.
 *
 * It no longer decides whether to show itself. It used to read a `localStorage`
 * dismissal and return `null` — so the grid reserved a full-width slot for a
 * card drawing nothing, and the reason lived here rather than in the
 * declaration. The widget declares `lifecycle: "conditional"` now and the host
 * drops it when the last step lands.
 *
 * It no longer derives completion either. The steps came from dashboard stats
 * read in the browser, which put the same four counts in two places and
 * answered a per-reader question per BROWSER. The host answers, and the
 * condition that decides whether this card is offered is derived from the same
 * call — so a fully ticked card and a card that will not go away are both
 * unreachable.
 *
 * @module components/features/dashboard/OnboardingChecklist
 */

import { Card, CardContent, CardHeader, CardTitle } from "@nextlyhq/ui";
import { CheckCircle2 } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  useOnboardingSteps,
  type OnboardingStepId,
  type OnboardingStepState,
} from "@admin/hooks/queries/useOnboardingSteps";
import { cn } from "@admin/lib/utils";

interface StepPresentation {
  label: string;
  /** Absent where the step cannot be acted on, which is the granted one. */
  href?: string;
}

/**
 * What each step is called and where it leads.
 *
 * An exhaustive `Record` keyed by the id union rather than a lookup with a
 * fallback: core owns which steps exist, and a step added there with no entry
 * here would otherwise draw a blank row. The compiler refuses this object until
 * every id has one.
 *
 * The copy lives here rather than in core because it is UI text pointing at
 * admin routes, and core renders neither.
 */
const PRESENTATION: Record<OnboardingStepId, StepPresentation> = {
  // No link: it is already done by everyone who can read this, and a call to
  // action on a finished step sends the reader somewhere with nothing to do.
  account: { label: "Create your account" },
  collection: {
    label: "Create a collection",
    href: ROUTES.BUILDER_COLLECTIONS_NEW,
  },
  // The CONTENT surface, not the schema builder. `BUILDER_COLLECTIONS` edits
  // what a collection IS; a reader told to add their first entry and sent
  // there arrives at field definitions, which is the one place the step cannot
  // be completed.
  entry: { label: "Add your first entry", href: ROUTES.COLLECTIONS },
};

function StepRow({ step }: { step: OnboardingStepState }) {
  const { label, href } = PRESENTATION[step.id];

  return (
    <li className="flex items-center justify-between py-3.5 group transition-colors px-2 rounded-md hover:bg-primary/[0.03]">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "h-6 w-6 rounded-sm flex items-center justify-center transition-all duration-500",
            step.complete
              ? "bg-success-500/10 border border-border border-success scale-110 shadow-glow-success"
              : "bg-primary/5 border border-border group-hover:border-primary group-hover:scale-105"
          )}
        >
          {step.complete ? (
            <CheckCircle2
              className="h-3.5 w-3.5 text-success-500 shrink-0"
              aria-hidden="true"
            />
          ) : (
            <div className="h-1.5 w-1.5 rounded-full bg-primary/20 group-hover:bg-primary/60 transition-colors" />
          )}
        </div>
        <span
          className={cn(
            "text-sm font-bold tracking-tight transition-all duration-500",
            step.complete
              ? "text-muted-foreground line-through"
              : "text-foreground/80 group-hover-unified"
          )}
        >
          {label}
          {/*
           * The tick and the strike-through both carry the state visually and
           * neither reaches a screen reader: `line-through` is styling, and the
           * icon is decorative. Without this the finished and unfinished rows
           * are announced identically.
           */}
          <span className="sr-only">
            {step.complete ? " — done" : " — still to do"}
          </span>
        </span>
      </div>
      {href && !step.complete && (
        <Link
          href={href}
          className="text-xs font-black uppercase tracking-[0.2em] text-primary hover:text-primary-foreground hover:bg-primary px-3 py-1.5 rounded-md ring-1 ring-primary/20 hover:ring-primary transition-all duration-500 transform active:scale-95"
        >
          {/* Names the step, so a reader moving by links does not meet a list
              of identical "Execute" targets. */}
          <span aria-hidden="true">Execute &rarr;</span>
          <span className="sr-only">{label}</span>
        </Link>
      )}
    </li>
  );
}

export const OnboardingChecklist: React.FC = () => {
  const { steps, completedCount, totalCount, isPending, isUnavailable } =
    useOnboardingSteps();

  // Distinguished from "nothing outstanding", which looks identical in the
  // numbers: a failed read leaves zero incomplete steps, and drawing a finished
  // checklist for someone whose progress could not be read is the one wrong
  // thing this card can say.
  if (isUnavailable) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Setup progress is unavailable right now.
        </CardContent>
      </Card>
    );
  }

  if (isPending || totalCount === 0) return null;

  const completionPct = Math.round((completedCount / totalCount) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-black uppercase tracking-[0.25em] text-muted-foreground">
          Set up your project
        </CardTitle>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          /*
           * The bar is the picture; the text beside it is the answer. Marked
           * decorative so the count is announced once rather than twice, in two
           * different phrasings.
           */
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-bold tracking-tight text-muted-foreground">
          {completedCount} of {totalCount} done
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {steps.map(step => (
            <StepRow key={step.id} step={step} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

OnboardingChecklist.displayName = "OnboardingChecklist";
