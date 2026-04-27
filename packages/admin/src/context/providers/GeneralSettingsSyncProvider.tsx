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
