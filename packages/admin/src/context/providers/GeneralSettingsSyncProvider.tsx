"use client";

import type React from "react";

import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

/**
 * Keeps general settings timezone synced in memory so all non-hook
 * date formatters can apply the selected timezone consistently.
 *
 * Renders NOTHING and sits BESIDE the layout subtree rather than around it.
 * The shape is load-bearing at the layout root: the public/private flip
 * re-renders that tree in place (logout and the signed-in redirect are
 * pushState navigations, not full page loads), and a swapped element type
 * AROUND the subtree would remount all of it — Toaster, portal root,
 * RestartOverlay — dropping whatever toast was in flight across the flip.
 * As a hook host it is a sibling with no data-path cost: nothing flows to
 * descendants, so there is nothing a wrapper would have carried.
 */
export function GeneralSettingsSync(): React.ReactElement | null {
  useAdminDateFormatter();
  return null;
}
