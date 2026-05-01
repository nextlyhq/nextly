"use client";

/**
 * Onboarding Progress Hook
 *
 * Derives onboarding checklist state from dashboard stats (via useDashboardStats)
 * and localStorage dismissal. No extra API call — TanStack Query deduplicates
 * the stats request.
 *
 * @module hooks/queries/useOnboardingProgress
 */

import { useCallback, useMemo, useState } from "react";

import { ROUTES } from "@admin/constants/routes";
import type {
  OnboardingProgress,
  OnboardingStep,
} from "@admin/types/dashboard/onboarding";

import { useDashboardStats } from "./useDashboardStats";

const STORAGE_KEY = "nextly_onboarding_dismissed";

function getIsDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * useOnboardingProgress Hook
 *
 * Auto-detects onboarding step completion from dashboard stats and
 * manages dismissal state via localStorage.
 *
 * @returns OnboardingProgress with steps, counts, dismissal state, and dismiss callback
 */
export function useOnboardingProgress() {
  const { data: stats } = useDashboardStats();
  const [isDismissed, setIsDismissed] = useState(getIsDismissed);

  const steps: OnboardingStep[] = useMemo(() => {
    return [
      {
        id: "create-collection",
        label: "Create a collection",
        description:
          "Define your first content type to start structuring your data",
        href: ROUTES.COLLECTIONS_CREATE,
        isComplete: (stats?.content.contentTypes ?? 0) > 0,
      },
      {
        id: "create-content",
        label: "Create content",
        description: "Add your first entry to a collection",
        href: ROUTES.COLLECTIONS,
        isComplete: (stats?.content.totalEntries ?? 0) > 0,
      },
      {
        id: "upload-media",
        label: "Upload media",
        description: "Upload an image or file to the media library",
        href: ROUTES.MEDIA,
        isComplete: (stats?.content.totalMedia ?? 0) > 0,
      },
      {
        id: "create-api-key",
        label: "Create an API key",
        description: "Generate an API key to access your content externally",
        href: ROUTES.SETTINGS_API_KEYS_CREATE,
        isComplete: (stats?.apiKeys ?? 0) > 0,
      },
      {
        id: "configure-security",
        label: "Configure security",
        description: "Review your security settings and CORS configuration",
        href: ROUTES.SETTINGS,
        isComplete: true, // Defaults to complete — security is pre-configured
      },
    ];
  }, [stats]);

  const completedCount = useMemo(
    () => steps.filter(s => s.isComplete).length,
    [steps]
  );

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable — still dismiss in-memory
    }
    setIsDismissed(true);
  }, []);

  const progress: OnboardingProgress = useMemo(
    () => ({
      steps,
      completedCount,
      totalCount: steps.length,
      isDismissed,
    }),
    [steps, completedCount, isDismissed]
  );

  return { progress, dismiss };
}
