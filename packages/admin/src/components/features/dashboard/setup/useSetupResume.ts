"use client";

/**
 * The query key of the reader's setup state, `GET /api/dashboard/setup`, which
 * a setup write asks again for.
 *
 * @module components/features/dashboard/setup/useSetupResume
 */

/** The reader's setup state. */
export const DASHBOARD_SETUP_KEY = ["dashboard", "setup"] as const;
