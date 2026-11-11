/**
 * Core's Team card, declared with `defineWidget`. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * Its `load` reads `system:team-people` as the caller its read services were
 * bound for: the people, most recently active first, at most its "Number of
 * people", of the role its header's filter names, and how many that role has
 * in all. The source asks the card's gate itself before it reads anyone, the
 * same `TEAM_GATE` the card is offered by, so the two cannot disagree.
 *
 * @module domains/widgets/core-widgets/team
 */

import { defineWidget } from "../declaration/define-widget";
import { setting } from "../declaration/setting-builders";
import { listEntries, MAX_WIDGET_ROWS } from "../query-limits";
import { TEAM_PEOPLE_SOURCE_ID } from "../system-source-ids";
import { TEAM_GATE } from "../team-gate";

import type { TeamPersonData, TeamWidgetData } from "./data";
import { CORE_WIDGET_ID } from "./ids";
import { readCoreList } from "./system-read";

/** The role filter's "everyone" choice: no role is asked for. */
export const ALL_ROLES = "all";

/**
 * The roles the card's filter offers: the built-in ones, by slug. A person
 * holding only a site's own role is listed under All roles, by that role.
 */
const ROLE_OPTIONS = [
  { label: "All roles", value: ALL_ROLES },
  { label: "Super admin", value: "super-admin" },
  { label: "Admin", value: "admin" },
  { label: "Editor", value: "editor" },
  { label: "Author", value: "author" },
  { label: "Viewer", value: "viewer" },
] as const;

/** Team's settings, in the order its settings drawer shows them. */
const TEAM_SETTINGS = {
  // The header's one quick control, and a setting like any other.
  role: setting.select({
    label: "Role",
    quick: true,
    options: ROLE_OPTIONS,
    defaultValue: ALL_ROLES,
    section: "data",
    admin: { description: "People can also switch this from the card." },
  }),
  // Named `limit`, so the drawer offers it as every list's 5, 10 or 20.
  limit: setting.number({
    label: "Number of people",
    defaultValue: 5,
    min: 1,
    max: MAX_WIDGET_ROWS,
    section: "data",
  }),
  lastActive: setting.checkbox({
    label: "Show last active",
    defaultValue: true,
    section: "display",
  }),
};

/** A row the source answered, as the card draws it, or `undefined` for one it cannot read. */
function personOf(row: Record<string, unknown>): TeamPersonData | undefined {
  if (typeof row.email !== "string") return undefined;
  return {
    email: row.email,
    ...(typeof row.name === "string" && row.name !== ""
      ? { name: row.name }
      : {}),
    ...(typeof row.role === "string" ? { role: row.role } : {}),
    ...(typeof row.lastActiveAt === "string"
      ? { lastActiveAt: row.lastActiveAt }
      : {}),
  };
}

export const teamWidget = defineWidget({
  id: CORE_WIDGET_ID.team,
  title: "Team",
  description: "The people on this project, filterable by role.",
  // Half the row by default; from a third, where a person's row still reads,
  // to the full width.
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  // Offered to the readers its source answers, by the one constant both read.
  access: TEAM_GATE,
  settings: TEAM_SETTINGS,
  load: async ({
    settings,
    services,
    signal,
    now,
  }): Promise<TeamWidgetData> => {
    const { items, total } = await readCoreList(
      {
        source: TEAM_PEOPLE_SOURCE_ID,
        op: "list",
        select: ["name", "email", "role", "lastActiveAt"],
        ...(settings.role === ALL_ROLES
          ? {}
          : { where: { role: settings.role } }),
        // Its "Number of people"; the source counts the rest for "View all (N)".
        limit: listEntries(settings.limit),
      },
      { services, signal, now }
    );
    const people = items.flatMap(row => {
      const person = personOf(row);
      return person === undefined ? [] : [person];
    });
    return { people, total: total ?? people.length };
  },
  // Its own component: each person's row, the role filter's empty state, and
  // a footer holding Invite beside its link to the Users page.
  view: { component: "core#TeamSummary" },
  // The component draws its own empty state, which names the role that has
  // no one, which the frame's one line could not.
  isEmpty: () => false,
});
