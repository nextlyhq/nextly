"use client";

import { Card, CardContent, CardHeader } from "@nextlyhq/ui";
import { Check, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";

import type { OfferedSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { cn } from "@admin/lib/utils";
import type { SeedResult, SeedSummary } from "@admin/services/seedApi";

import { AccentBar } from "./seed-card/AccentBar";
import { Eyebrow, type EyebrowState } from "./seed-card/Eyebrow";
import { ProgressList } from "./seed-card/ProgressList";
import { StatChip } from "./seed-card/StatChip";

export interface SeedDemoContentCardProps {
  status: OfferedSeedStatus;
  onSeed: () => void;
  onSkip: () => void;
  /** Leaves the offer for the dashboard, once a seed has succeeded. */
  onContinue: () => void;
}

/** The heading each state opens with. */
const HEADINGS: Record<EyebrowState, string> = {
  idle: "Welcome to Nextly.",
  seeding: "Loading demo content…",
  success: "Demo content seeded.",
  "success-partial": "Demo content seeded with warnings.",
  error: "Couldn't seed demo content.",
};

/** The counts a finished seed reports as chips, in the order they are drawn. */
const COUNTED: ReadonlyArray<readonly [keyof SeedSummary, string]> = [
  ["rolesCreated", "Roles"],
  ["usersCreated", "Users"],
  ["categoriesCreated", "Categories"],
  ["tagsCreated", "Tags"],
  ["postsCreated", "Posts"],
];

/**
 * The eyebrow a state wears. A success that left warnings is its own state, so
 * the warnings are read before the offer is let go.
 */
function eyebrowFor(status: OfferedSeedStatus): EyebrowState {
  if (status.kind !== "success") return status.kind;
  return status.result.warnings.length > 0 ? "success-partial" : "success";
}

/** The one filled action a state offers: seed, retry, or continue. */
function PrimaryAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-xs font-bold tracking-[0.05em] text-primary-foreground hover:bg-primary/85 hover:-translate-y-0.5 transition-all"
    >
      {children}
    </button>
  );
}

/** Declining the offer, as a quiet text action beside the filled one. */
function SkipAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold tracking-[0.04em] text-muted-foreground underline underline-offset-4 decoration-1 decoration-muted-foreground/30 hover:text-foreground hover:decoration-foreground"
    >
      Skip — I&rsquo;ll add my own content
    </button>
  );
}

/** What a finished seed created, what it warned about, and the way on. */
function SeededSummary({
  result,
  onContinue,
}: {
  result: SeedResult;
  onContinue: () => void;
}) {
  const { summary, warnings } = result;
  const media = summary.mediaUploaded + summary.mediaSkipped;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {COUNTED.filter(([key]) => summary[key] > 0).map(([key, label]) => (
          <StatChip key={key} count={summary[key]} label={label} />
        ))}
        {media > 0 && (
          <StatChip
            count={`${summary.mediaUploaded}/${media}`}
            label="Media"
            tone={summary.mediaSkipped > 0 ? "warning" : "neutral"}
          />
        )}
      </div>

      {warnings.length > 0 && (
        <details className="text-sm text-muted-foreground max-w-xl group/warnings">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors">
            View {warnings.length} warning
            {warnings.length === 1 ? "" : "s"} →
          </summary>
          <ul className="mt-3 font-mono text-xs text-muted-foreground space-y-1 pl-4 border-l border-border">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-sm text-muted-foreground max-w-xl">
        Visit your{" "}
        <a
          href="/"
          className="font-bold text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground"
        >
          site
        </a>{" "}
        or browse{" "}
        <a
          href="/admin/collections/posts"
          className="font-bold text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground"
        >
          posts in admin
        </a>
        .
      </p>

      <div className="pt-1">
        <PrimaryAction onClick={onContinue}>
          Continue to your dashboard
          <span aria-hidden="true">→</span>
        </PrimaryAction>
      </div>
    </>
  );
}

/**
 * The demo-content offer, drawn for the state it is in.
 *
 * Presentational: the state and every action arrive as props. The empty
 * dashboard owns `useSeedStatus`, because the instance that runs the seed has
 * to be the one choosing what the page shows -- its mid-flight state lives in
 * that instance, and a second one would see the offer answered and swap this
 * card out while it was still reporting how the seed went.
 *
 * Leaving is the dashboard's decision for the same reason: it holds this on
 * screen through a seed and lets it go on Continue, on Skip, or a few seconds
 * after a success with nothing to read.
 */
export function SeedDemoContentCard({
  status,
  onSeed,
  onSkip,
  onContinue,
}: SeedDemoContentCardProps) {
  const eyebrowState = eyebrowFor(status);
  const accentState =
    eyebrowState === "success-partial" ? "success" : eyebrowState;

  return (
    <Card
      // Full-strength hover and status borders so the card boundary is perceivable at the 3:1 UI minimum, not a fainter alpha.
      className={cn(
        "group/card relative rounded-lg border-border bg-primary/[0.01] backdrop-blur-md overflow-hidden transition-all duration-700 hover:border-primary",
        // Subtle hairline tint — no gradient flood. The accent bar at
        // the top carries the dominant color cue; the card body stays
        // neutral so the eye reads the content first, status second.
        status.kind === "success" && "border-success",
        status.kind === "error" && "border-destructive"
      )}
    >
      <AccentBar state={accentState} />

      <CardHeader
        noBorder
        className="flex flex-row items-start justify-between space-y-0 px-8 pt-9 pb-2"
      >
        <div className="space-y-2">
          <Eyebrow
            state={eyebrowState}
            warningCount={
              status.kind === "success"
                ? status.result.warnings.length
                : undefined
            }
          />
          <h2 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-3">
            {status.kind === "success" && (
              <Check
                className="h-[18px] w-[18px] text-success shrink-0"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}
            {HEADINGS[eyebrowState]}
          </h2>
        </div>

        {/* Only where declining is still a choice. Mid-seed there is nothing
            to decline, and after a success Continue is the way on -- a skip
            there would record the offer as declined after it was accepted. */}
        {(status.kind === "idle" || status.kind === "error") && (
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip seeding"
            // Revealed on keyboard focus as well as on hover: a control that
            // appears only under a pointer is invisible to a reader who tabs
            // onto it.
            className="rounded-md h-8 w-8 flex items-center justify-center text-primary/20 hover:text-primary focus-visible:text-primary hover:bg-primary/5 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-all duration-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </CardHeader>

      <CardContent className="px-8 pb-8 space-y-6">
        {status.kind === "idle" && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
              This project uses the{" "}
              <span className="inline-flex items-center px-2 py-0.5 mx-0.5 text-xs font-bold uppercase tracking-[0.15em] rounded-md bg-primary/[0.04] border border-primary/[0.08] text-foreground align-baseline">
                {status.template.label} template
              </span>{" "}
              — load sample posts, authors, categories, and a homepage to
              explore how everything fits together. You can delete it later.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
              <PrimaryAction onClick={onSeed}>
                Seed demo content
                <span aria-hidden="true">→</span>
              </PrimaryAction>
              <SkipAction onClick={onSkip} />
            </div>
          </>
        )}

        {status.kind === "seeding" && (
          <>
            <ProgressList />
            <div className="pt-1">
              <button
                type="button"
                disabled
                aria-busy="true"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-xs font-bold tracking-[0.05em] text-primary-foreground opacity-60 cursor-not-allowed"
              >
                <span className="h-3.5 w-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Seeding…
              </button>
            </div>
          </>
        )}

        {status.kind === "success" && (
          <SeededSummary result={status.result} onContinue={onContinue} />
        )}

        {status.kind === "error" && (
          <>
            {/* Full-strength destructive border and label text so the error is readable and its boundary perceivable. */}
            <div className="font-mono text-xs text-foreground bg-primary/[0.02] border border-destructive px-4 py-3 rounded-md">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-destructive mb-1">
                Error
              </div>
              {status.message}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
              <PrimaryAction onClick={onSeed}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry seed
              </PrimaryAction>
              <SkipAction onClick={onSkip} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
