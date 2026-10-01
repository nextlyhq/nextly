"use client";

import type React from "react";

import { useAdminDateFormatter } from "@admin/hooks/useAdminDateFormatter";

interface GeneralSettingsSyncProviderProps {
  children: React.ReactNode;
}

/**
 * Keeps general settings timezone synced in memory so all non-hook
 * date formatters can apply the selected timezone consistently.
 */
export function GeneralSettingsSyncProvider({
  children,
}: GeneralSettingsSyncProviderProps) {
  useAdminDateFormatter();
  return <>{children}</>;
}

/**
 * The same sync as {@link GeneralSettingsSyncProvider}, as a component that
 * renders NOTHING and is meant to sit BESIDE the layout subtree rather than
 * around it.
 *
 * The two are not interchangeable shapes. This is a hook host, not a context
 * provider — no value flows to descendants, so a sibling loses nothing on
 * the data path. What the sibling gains is stability at the layout root:
 * the public/private flip re-renders that tree in place (logout and the
 * signed-in redirect are pushState navigations, not full page loads), and a
 * swapped element type AROUND the subtree would remount all of it —
 * Toaster, portal root, RestartOverlay — dropping whatever toast was in
 * flight across the flip.
 */
export function GeneralSettingsSync(): React.ReactElement | null {
  useAdminDateFormatter();
  return null;
}
