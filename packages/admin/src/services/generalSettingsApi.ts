/**
 * General Settings API Service
 *
 * API client for managing the general application settings singleton.
 *
 * @module services/generalSettingsApi
 * @since 1.0.0
 */

import { enhancedFetcher } from "../lib/api/enhancedFetcher";

// ============================================================
// Types
// ============================================================

export interface GeneralSettingsRecord {
  id: string;
  applicationName: string | null;
  siteUrl: string | null;
  adminEmail: string | null;
  timezone: string | null;
  dateFormat: string | null;
  timeFormat: string | null;
  logoUrl: string | null;
  updatedAt: string;
}

export interface UpdateGeneralSettingsPayload {
  applicationName?: string | null;
  siteUrl?: string | null;
  adminEmail?: string | null;
  timezone?: string | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
  logoUrl?: string | null;
}

// ============================================================
// API Functions
// ============================================================

/**
 * Retrieve the current general settings.
 */
export async function getGeneralSettings(): Promise<GeneralSettingsRecord> {
  const result = await enhancedFetcher<GeneralSettingsRecord>(
    `/general-settings`,
    {
      cache: "no-store",
    },
    true
  );
  return result.data;
}

/**
 * Update the general settings.
 */
export async function updateGeneralSettings(
  data: UpdateGeneralSettingsPayload
): Promise<GeneralSettingsRecord> {
  const result = await enhancedFetcher<GeneralSettingsRecord>(
    `/general-settings`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    true
  );
  return result.data;
}
