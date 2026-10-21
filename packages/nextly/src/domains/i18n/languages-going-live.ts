/**
 * Which languages a publish of every language puts live.
 *
 * One answer for a collection entry and a Single alike, so the publish rule
 * is asked about the same languages whichever is published, and the
 * validation of what goes live judges the same ones.
 *
 * @module domains/i18n/languages-going-live
 */

/**
 * The languages a publish of every language puts live: each stored
 * translation not yet published, among the languages the site still
 * configures, and the default language where it stores no translation and
 * the main row is not yet published, since the main row goes live with it
 * whether or not it stores one.
 *
 * A removed language's row can outlive it, and judged it would be read as the
 * default language, refusing every publish over content no request can reach
 * to repair; so only configured languages count.
 */
export function languagesGoingLiveFrom(args: {
  /** Each stored translation's status, by language. */
  statuses: ReadonlyMap<string, string | null>;
  /** The languages the site configures; none means every stored one counts. */
  configured: readonly string[];
  defaultLocale: string | undefined;
  /** Whether the main row is already published. */
  mainPublished: boolean;
}): string[] {
  const configured = new Set(args.configured);
  const going = [...args.statuses]
    .filter(
      ([locale, status]) =>
        status !== "published" &&
        (configured.size === 0 || configured.has(locale))
    )
    .map(([locale]) => locale);
  if (
    args.defaultLocale !== undefined &&
    !args.statuses.has(args.defaultLocale) &&
    !args.mainPublished
  ) {
    going.push(args.defaultLocale);
  }
  return going;
}
