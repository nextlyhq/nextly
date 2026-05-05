"use client";

import { Card, CardContent, CardHeader } from "@revnixhq/ui";
import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useSeedStatus } from "@admin/hooks/queries/useSeedStatus";
import { cn } from "@admin/lib/utils";

import { AccentBar } from "./seed-card/AccentBar";
import { Eyebrow, type EyebrowState } from "./seed-card/Eyebrow";
import { ProgressList } from "./seed-card/ProgressList";
import { StatChip } from "./seed-card/StatChip";

/**
 * SeedDemoContentCard — discoverable replacement for the deleted
 * /welcome page's seed button. Renders above the OnboardingChecklist
 * on /admin for any non-blank template (probe gates visibility), and
 * disappears forever once the user clicks Seed or Skip.
 *
 * State machine lives in useSeedStatus; this component just maps each
 * `status.kind` to markup. Auto-hide-on-success has a 5s delay so the
 * user can read the stat chips before the card collapses.
 */

const AUTO_HIDE_MS = 5000;

export function SeedDemoContentCard() {
  const { status, startSeed, skip } = useSeedStatus();
  const [autoHidden, setAutoHidden] = useState(false);

  useEffect(() => {
    if (status.kind !== "success") return;
    // Partial success → keep the card around so the user reads warnings.
    if (status.result.warnings.length > 0) return;
    const t = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [status]);

  if (status.kind === "loading" || status.kind === "hidden" || autoHidden) {
    return null;
  }

  const eyebrowState: EyebrowState =
    status.kind === "success" && status.result.warnings.length > 0
      ? "success-partial"
      : status.kind === "success"
        ? "success"
        : status.kind === "seeding"
          ? "seeding"
          : status.kind === "error"
            ? "error"
            : "idle";

  const accentState =
    eyebrowState === "success-partial" ? "success" : eyebrowState;

  return (
    <Card
      className={cn(
        "group/card relative rounded-none border-primary/5 bg-primary/[0.01] backdrop-blur-md overflow-hidden transition-all duration-700 hover:border-primary/40",
        (eyebrowState === "success" || eyebrowState === "success-partial") &&
          "border-success/25 bg-gradient-to-b from-success/[0.04] to-transparent",
        eyebrowState === "error" &&
          "border-destructive/30 bg-gradient-to-b from-destructive/[0.04] to-transparent"
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
          <h2 className="text-[22px] font-black tracking-tight text-foreground flex items-center gap-3">
            {(eyebrowState === "success" ||
              eyebrowState === "success-partial") && (
              <Check
                className="h-[22px] w-[22px] text-success shrink-0"
                strokeWidth={3}
                aria-hidden="true"
              />
            )}
            {eyebrowState === "idle" && "Welcome to Nextly."}
            {eyebrowState === "seeding" && "Loading demo content…"}
            {eyebrowState === "success" && "Demo content seeded."}
            {eyebrowState === "success-partial" &&
              "Demo content seeded with warnings."}
            {eyebrowState === "error" && "Couldn't seed demo content."}
          </h2>
        </div>

        {eyebrowState !== "seeding" && (
          <button
            type="button"
            onClick={skip}
            aria-label="Skip seeding"
            className="rounded-none h-8 w-8 flex items-center justify-center text-primary/20 hover:text-primary hover:bg-primary/5 opacity-0 group-hover/card:opacity-100 transition-all duration-500"
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
              <span className="inline-flex items-center px-2 py-0.5 mx-0.5 text-[9px] font-bold uppercase tracking-[0.15em] rounded-none bg-primary/[0.04] border border-primary/[0.08] text-foreground align-baseline">
                {status.template.label} template
              </span>{" "}
              — load sample posts, authors, categories, and a homepage to
              explore how everything fits together. You can delete it later.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
              <button
                type="button"
                onClick={startSeed}
                className="inline-flex items-center gap-2 rounded-none bg-primary px-5 py-2.5 text-xs font-bold tracking-[0.05em] text-primary-foreground hover:bg-primary/85 hover:-translate-y-0.5 transition-all"
              >
                Seed demo content
                <span aria-hidden="true">→</span>
              </button>
              <button
                type="button"
                onClick={skip}
                className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground underline underline-offset-4 decoration-1 decoration-muted-foreground/30 hover:text-foreground hover:decoration-foreground"
              >
                Skip — I&rsquo;ll add my own content
              </button>
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
                className="inline-flex items-center gap-2 rounded-none bg-primary px-5 py-2.5 text-xs font-bold tracking-[0.05em] text-primary-foreground opacity-60 cursor-not-allowed"
              >
                <span className="h-3.5 w-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Seeding…
              </button>
            </div>
          </>
        )}

        {status.kind === "success" && (
          <>
            <div className="flex flex-wrap gap-2">
              {status.result.summary.rolesCreated > 0 && (
                <StatChip
                  count={status.result.summary.rolesCreated}
                  label="Roles"
                />
              )}
              {status.result.summary.usersCreated > 0 && (
                <StatChip
                  count={status.result.summary.usersCreated}
                  label="Users"
                />
              )}
              {status.result.summary.categoriesCreated > 0 && (
                <StatChip
                  count={status.result.summary.categoriesCreated}
                  label="Categories"
                />
              )}
              {status.result.summary.tagsCreated > 0 && (
                <StatChip
                  count={status.result.summary.tagsCreated}
                  label="Tags"
                />
              )}
              {status.result.summary.postsCreated > 0 && (
                <StatChip
                  count={status.result.summary.postsCreated}
                  label="Posts"
                />
              )}
              {status.result.summary.mediaUploaded +
                status.result.summary.mediaSkipped >
                0 && (
                <StatChip
                  count={`${status.result.summary.mediaUploaded}/${
                    status.result.summary.mediaUploaded +
                    status.result.summary.mediaSkipped
                  }`}
                  label="Media"
                  tone={
                    status.result.summary.mediaSkipped > 0
                      ? "warning"
                      : "neutral"
                  }
                />
              )}
            </div>

            {status.result.warnings.length > 0 && (
              <details className="text-sm text-muted-foreground max-w-xl group/warnings">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors">
                  View {status.result.warnings.length} warning
                  {status.result.warnings.length === 1 ? "" : "s"} →
                </summary>
                <ul className="mt-3 font-mono text-[11px] text-muted-foreground space-y-1 pl-4 border-l border-border">
                  {status.result.warnings.map((w, i) => (
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
          </>
        )}

        {status.kind === "error" && (
          <>
            <div className="font-mono text-[12px] text-foreground bg-destructive/[0.04] border border-destructive/20 px-4 py-3 rounded-none">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-destructive mb-1">
                Error
              </div>
              {status.message}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
              <button
                type="button"
                onClick={startSeed}
                className="inline-flex items-center gap-2 rounded-none bg-primary px-5 py-2.5 text-xs font-bold tracking-[0.05em] text-primary-foreground hover:bg-primary/85 hover:-translate-y-0.5 transition-all"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry seed
              </button>
              <button
                type="button"
                onClick={skip}
                className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground underline underline-offset-4 decoration-1 decoration-muted-foreground/30 hover:text-foreground hover:decoration-foreground"
              >
                Skip — I&rsquo;ll add my own content
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
