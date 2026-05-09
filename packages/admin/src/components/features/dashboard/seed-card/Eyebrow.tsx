import { cn } from "@admin/lib/utils";

export type EyebrowState =
  | "idle"
  | "seeding"
  | "success"
  | "success-partial"
  | "error";

const COPY: Record<
  EyebrowState,
  { primary: string; sub: string; toneClass: string }
> = {
  idle: {
    primary: "Welcome / Seed",
    sub: "Step 0",
    toneClass: "text-primary/80",
  },
  seeding: {
    primary: "Seeding in progress",
    sub: "Do not refresh",
    toneClass: "text-primary/80",
  },
  // Success / error eyebrows stay tonally neutral — the accent bar
  // carries the color signal. Coloring the eyebrow text too produces
  // a "generic semantic colors everywhere" look that reads AI-ish.
  // Restraint: tone matches the brutalist OnboardingChecklist where
  // status colors live in tiny accents (icon, hairline) only.
  success: {
    primary: "Seed complete",
    sub: "Auto-hides in 5s",
    toneClass: "text-primary/80",
  },
  "success-partial": {
    primary: "Seed complete",
    sub: "",
    toneClass: "text-primary/80",
  },
  error: {
    primary: "Seed failed",
    sub: "No partial data was written",
    toneClass: "text-primary/80",
  },
};

/**
 * Two stacked uppercase micro-labels at the top of the card. The
 * primary label encodes state, the sub label gives a short hint
 * ("Auto-hides in 5s", "N warnings", etc.).
 */
export function Eyebrow({
  state,
  warningCount,
}: {
  state: EyebrowState;
  warningCount?: number;
}) {
  const c = COPY[state];
  let sub = c.sub;
  if (state === "success-partial") {
    const n = warningCount ?? 0;
    sub = `${n} warning${n === 1 ? "" : "s"}`;
  }
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "text-[10px] font-black uppercase tracking-[0.3em]",
          c.toneClass
        )}
      >
        {c.primary}
      </span>
      {sub ? (
        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground/50">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
