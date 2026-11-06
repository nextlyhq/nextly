/**
 * One list of addresses every road's check is given, so a road that judges an
 * address differently from the rule fails beside the others. Among them the
 * names the roads disagreed about before the one rule (`admin`,
 * `team-updates`, `select`, `accounts`, 51 characters), and one case for each
 * other reason the rule gives.
 */
export const ADDRESS_CASES: readonly string[] = [
  "admin",
  "team-updates",
  "select",
  "accounts",
  "a".repeat(51),
  "cascade",
  "settings",
  "field-groups",
  "posts_locales",
  "Team",
  "a".repeat(48),
  "a".repeat(49),
  "team_updates",
  "posts-",
];
