/**
 * The zones the calendar can be read in, grouped as the zone control offers
 * them, and how each one is named.
 *
 * The reader's own zone first, the one the list reads times in. Then the
 * zones the releases on screen were scheduled in: those are the ones this
 * page has a reason to offer, since "which day is it on for the Karachi team"
 * is the question a distributed launch actually asks. Then every other zone
 * the platform knows, for the colleague whose zone nothing on screen names.
 *
 * @module components/features/releases/release-calendar-zones
 */
import { isValidTimezone } from "@admin/lib/dates/format";

/** One group of the zone control. */
export interface CalendarZoneGroup {
  id: "reader" | "scheduled" | "all";
  label: string;
  zones: string[];
}

/**
 * The zone control's groups, each zone in exactly one of them.
 *
 * Empty groups are left out. The zone being shown is always offered, even
 * when the platform's list lacks it (an alias such as `Asia/Calcutta`, or a
 * runtime without `Intl.supportedValuesOf`), so the control never shows a
 * value it cannot select.
 */
export function calendarZoneGroups({
  reader,
  current,
  scheduled,
  supported,
}: {
  reader: string;
  current: string;
  scheduled: readonly string[];
  supported: readonly string[];
}): CalendarZoneGroup[] {
  const seen = new Set<string>([reader]);
  const fromReleases = [...new Set(scheduled)]
    .filter(zone => !seen.has(zone) && isValidTimezone(zone))
    .sort();
  for (const zone of fromReleases) seen.add(zone);
  const rest = [
    ...(seen.has(current) || supported.includes(current) ? [] : [current]),
    ...supported.filter(zone => !seen.has(zone)),
  ];
  const groups: CalendarZoneGroup[] = [
    { id: "reader", label: "Your time zone", zones: [reader] },
    { id: "scheduled", label: "Scheduled in", zones: fromReleases },
    { id: "all", label: "All time zones", zones: rest },
  ];
  return groups.filter(group => group.zones.length > 0);
}

/**
 * The offset `zone` runs at on `at`, as "GMT+5" or "GMT-4", or an empty
 * string where the platform will not say.
 *
 * Read for a date rather than fixed, because a zone with daylight saving has
 * two offsets a year and the one that matters is the one of the month shown.
 */
export function zoneOffsetLabel(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find(part => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** A zone's name as a person reads it: `America/New_York` as "America/New York". */
export function zoneDisplayName(zone: string): string {
  return zone.replace(/_/g, " ");
}

/**
 * The platform's zone list, read once.
 *
 * Roughly four hundred entries, constant for the life of the runtime, so it
 * is not re-read on every render. Empty where the runtime has no
 * `Intl.supportedValuesOf`; the zone control still offers the reader's zone,
 * the scheduled ones and the one shown.
 */
let supportedZonesCache: string[] | null = null;

export function supportedZones(): string[] {
  if (supportedZonesCache !== null) return supportedZonesCache;
  try {
    const of = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    supportedZonesCache = typeof of === "function" ? of("timeZone") : [];
  } catch {
    supportedZonesCache = [];
  }
  return supportedZonesCache;
}
