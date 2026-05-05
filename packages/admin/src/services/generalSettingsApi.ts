/**
 * General Settings API Service
 *
 * API client for managing the general application settings singleton.
 *
 * @module services/generalSettingsApi
 * @since 1.0.0
 */

import { fetcher } from "../lib/api/fetcher";
import type { MutationResponse } from "../lib/api/response-types";

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
  return fetcher<GeneralSettingsRecord>(
    `/general-settings`,
    {
      cache: "no-store",
    },
    true
  );
}

/**
 * Update the general settings.
 */
export async function updateGeneralSettings(
  data: UpdateGeneralSettingsPayload
): Promise<GeneralSettingsRecord> {
  const result = await fetcher<MutationResponse<GeneralSettingsRecord>>(
    `/general-settings`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    true
  );
  return result.item;
}
