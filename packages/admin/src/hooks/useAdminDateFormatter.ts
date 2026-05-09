"use client";

import { useMemo } from "react";

import { useGeneralSettings } from "@admin/hooks/queries/useGeneralSettings";
import {
  formatGlobalDateTime,
  resolveLocalTimezone,
  setGlobalDateTimeConfig,
  type GlobalFormatDateOptions,
} from "@admin/lib/dates/format";

export type FormatDateOptions = GlobalFormatDateOptions;

export function formatDateWithAdminTimezone(
  value: string | number | Date | null | undefined,
  options: FormatDateOptions,
  fallback: string = "N/A"
): string {
  return formatGlobalDateTime(value, options, fallback);
}

/**
 * Centralized date formatter that applies General Settings timezone
 * to all admin date/time rendering.
 */
export function useAdminDateFormatter() {
  const { data: settings } = useGeneralSettings();

  const timezone = settings?.timezone || resolveLocalTimezone();
  const dateFormat = settings?.dateFormat ?? undefined;
  const timeFormat = settings?.timeFormat ?? undefined;

  setGlobalDateTimeConfig({
    timezone,
    dateFormat,
    timeFormat,
    locale: "en-US",
  });

  const withTimezone = useMemo(() => {
    return (options: FormatDateOptions = {}) => {
      return { ...options };
    };
  }, []);

  const formatDate = (
    value: string | number | Date | null | undefined,
    options: FormatDateOptions,
    fallback: string = "N/A"
  ): string => {
    return formatGlobalDateTime(value, withTimezone(options), fallback);
  };

  return {
    timezone,
    dateFormat,
    timeFormat,
    formatDate,
  };
}
