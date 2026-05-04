import { Card, CardContent, CardHeader, CardTitle } from "@revnixhq/ui";
import { CheckCircle2, X } from "lucide-react";
import type React from "react";

import { Link } from "@admin/components/ui/link";
import { useOnboardingProgress } from "@admin/hooks/queries/useOnboardingProgress";
import { cn } from "@admin/lib/utils";
import type { OnboardingStep } from "@admin/types/dashboard/onboarding";

function StepRow({ step }: { step: OnboardingStep }) {
  return (
    <div className="flex items-center justify-between py-3.5 group transition-colors px-2 rounded-none hover:bg-primary/[0.03]">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "h-6 w-6 rounded-none flex items-center justify-center transition-all duration-500",
            step.isComplete
              ? "bg-emerald-500/10  border border-primary/5 border-emerald-500/30 scale-110 shadow-glow-success"
              : "bg-primary/5  border border-primary/5 group-hover:border-primary/30 group-hover:scale-105"
          )}
        >
          {step.isComplete ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          ) : (
            <div className="h-1.5 w-1.5 rounded-none bg-primary/20 group-hover:bg-primary/60 transition-colors" />
          )}
        </div>
        <span
          className={cn(
            "text-[13px] font-bold tracking-tight transition-all duration-500",
            step.isComplete
              ? "text-muted-foreground/30 line-through"
              : "text-foreground/80 group-hover-unified"
          )}
        >
          {step.label}
        </span>
      </div>
      {!step.isComplete && (
        <Link
          href={step.href}
          className="text-[9px] font-black uppercase tracking-[0.2em] text-primary hover:text-white hover:bg-primary px-3 py-1.5 rounded-none ring-1 ring-primary/20 hover:ring-primary transition-all duration-500 transform active:scale-95"
        >
          Execute &rarr;
        </Link>
      )}
    </div>
  );
}

export const OnboardingChecklist: React.FC = () => {
  const { progress, dismiss } = useOnboardingProgress();

  if (progress.isDismissed || progress.completedCount >= progress.totalCount) {
    return null;
  }

  const completionPct = (progress.completedCount / progress.totalCount) * 100;

  return (
    <Card className="border-primary/5 bg-primary/[0.01] backdrop-blur-md overflow-hidden rounded-none] transition-all duration-700 hover:border-primary/40 group/card relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-primary/5">
        <div
          className="h-full bg-primary shadow-glow-primary transition-all duration-1000 ease-out"
          style={{ width: `${completionPct}%` }}
        />
      </div>

      <CardHeader
        noBorder
        className="flex flex-row items-center justify-between space-y-0 px-8 pt-9 pb-4"
      >
        <div className="flex items-center gap-4">
          <div className="space-y-1">
            <CardTitle className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/80">
              Launch Sequence
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-black text-foreground tracking-tighter">
                {progress.completedCount} of {progress.totalCount}
              </span>
              <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest bg-primary/5 px-2 py-0.5 rounded-none">
                {Math.round(completionPct)}%
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-none h-8 w-8 flex items-center justify-center text-primary/20 hover-unified transition-all duration-500 opacity-0 group-hover/card:opacity-100"
          aria-label="Dismiss sequence"
        >
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        <div className="space-y-1 bg-white/40 dark:bg-slate-950/20 p-2 rounded-none]  border border-primary/5">
          {progress.steps.map(step => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
        <p className="text-[9px] text-center text-muted-foreground/30 font-black uppercase tracking-[0.25em] mt-6 px-4">
          Complete initial configuration to unlock full analysis
        </p>
      </CardContent>
    </Card>
  );
};
