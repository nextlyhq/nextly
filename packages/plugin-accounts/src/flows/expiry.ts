/**
 * When a link stops working, as an email says it: the instant itself, and
 * the same instant written for a person in the site's time zone.
 */
export interface Expiry {
  /** The instant, in ISO 8601 UTC, for a template that formats it itself. */
  expiresAt: string;
  /** The instant in the site's time zone, such as "30 November 2026, 5:00 PM". */
  expiresAtText: string;
  /** The IANA time zone `expiresAtText` is written in. */
  timeZone: string;
}

/**
 * A link's expiry for an email, written in `timeZone`. Built from the
 * formatter's parts in a fixed order, so the text is the same whatever
 * locale data the runtime carries.
 */
export function expiryFor(at: Date, timeZone: string): Expiry {
  const parts = new Map(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(at)
      .map(part => [part.type, part.value])
  );
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.get(type) ?? "";

  return {
    expiresAt: at.toISOString(),
    expiresAtText: `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()}`,
    timeZone,
  };
}
