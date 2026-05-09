/**
 * Identifiers for each onboarding checklist step.
 * Used as keys for localStorage persistence and auto-detection.
 */
export type OnboardingStepId =
  | "create-collection"
  | "create-content"
  | "upload-media"
  | "create-api-key"
  | "configure-security";

/**
 * A single step in the onboarding checklist.
 */
export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  description: string;
  href: string; // Link to the relevant admin page
  isComplete: boolean; // Auto-detected from real data
}

/**
 * Overall onboarding progress state.
 * Shown only when fewer than 3 steps are complete and not dismissed.
 */
export interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  isDismissed: boolean;
}
