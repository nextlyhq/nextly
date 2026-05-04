import { cn } from "@admin/lib/utils";

export type AccentBarState = "idle" | "seeding" | "success" | "error";

const COLOR_CLASS: Record<AccentBarState, string> = {
  idle: "bg-primary",
  seeding: "bg-primary",
  success: "bg-success",
  error: "bg-destructive",
};

const WIDTH_CLASS: Record<AccentBarState, string> = {
  idle: "w-0",
  seeding: "w-full animate-pulse",
  success: "w-full",
  error: "w-full",
};

/**
 * 1px state-coloured stripe along the top of the SeedDemoContentCard.
 * Matches the OnboardingChecklist progress bar visually but encodes
 * card state, not progress percentage.
 */
export function AccentBar({ state }: { state: AccentBarState }) {
  return (
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 right-0 h-px bg-primary/5 overflow-hidden"
    >
      <span
        className={cn(
          "block h-full transition-all duration-700 ease-out",
          COLOR_CLASS[state],
          WIDTH_CLASS[state]
        )}
      />
    </div>
  );
}
