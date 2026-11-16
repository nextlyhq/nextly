/**
 * The people a dashboard's Team card lists: each person's name, email, the
 * role they hold now and when they were last active, most recently active
 * first, optionally only those holding one role, and how many there are in all.
 *
 * ## Last active
 *
 * The users table records no activity of its own. Two rows say a person was
 * using the admin, and this read takes the later of them:
 *
 * - the newest refresh row they hold: written at every sign-in and at every
 *   session renewal, so it moves while they work, and is deleted when they
 *   sign out or their sessions are ended;
 * - their newest `login-succeeded` audit row: kept after they sign out, for as
 *   long as the audit retention keeps sign-ins.
 *
 * A person with neither (never signed in, or signed out longer ago than the
 * retention window) has no last active, and is listed after everyone who has.
 *
 * ## The read
 *
 * Three statements, whatever the page's size: the count, the page (filtered,
 * ordered and cut in the database, its last-active pair read per person by
 * the two tables' user indexes), and the roles of exactly the page's people.
 * Only the columns the card draws are selected: nothing else about a person
 * leaves this module.
 *
 * @module domains/users/services/team-people
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  max,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";

import { roleAssignmentInForce } from "../../../services/lib/role-assignments";

/** One person on the Team card. */
export interface TeamPerson {
  id: string;
  name: string | null;
  email: string;
  /**
   * The role shown beside them: the one the list was filtered by, or else the
   * highest-level role they hold now. Absent when they hold none.
   */
  role?: { slug: string; name: string };
  /** When they last signed in or renewed a session; absent when unknown. */
  lastActiveAt?: Date;
}

/** Who to list, and how many. */
export interface TeamPeopleOptions {
  /** Only people holding this role (by slug) now; everyone when absent. */
  roleSlug?: string;
  /** The most people answered. */
  limit: number;
  /** The instant role assignments are judged at. */
  now: Date;
}

/** A page of people, and how many the filter matched in all. */
export interface TeamPeoplePage {
  people: TeamPerson[];
  total: number;
}

/** The columns this read touches, on any dialect. */
export interface TeamPeopleTables {
  users: { id: Column; name: Column; email: Column };
  userRoles: { userId: Column; roleId: Column; expiresAt: Column };
  roles: { id: Column; slug: Column; name: Column; level: Column };
  refreshTokens: { userId: Column; createdAt: Column };
  auditLog: { actorUserId: Column; kind: Column; createdAt: Column };
}

/**
 * The untyped query builder: the services reach a database whose dialect is
 * known only at run time, so its builders' static types are dropped, and an
 * awaited chain resolves to rows.
 */
interface QueryChain {
  [key: string]: (
    ...args: unknown[]
  ) => QueryChain & PromiseLike<Record<string, unknown>[]>;
}

/** The audit kind a successful sign-in is recorded under. */
const SIGN_IN_KIND = "login-succeeded";

/** `value` as a Date, when it is a valid one. */
function asDate(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value
    : undefined;
}

/** The later of two instants, either of which may be unknown. */
function later(a: Date | undefined, b: Date | undefined): Date | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * The later of two nullable SQL instants, as one expression every dialect
 * reads alike: PostgreSQL's GREATEST skips a NULL, while MySQL's and SQLite's
 * answer NULL for it.
 */
function laterOf(a: SQL, b: SQL): SQL {
  return sql`CASE WHEN ${a} IS NULL THEN ${b} WHEN ${b} IS NULL THEN ${a} WHEN ${a} > ${b} THEN ${a} ELSE ${b} END`;
}

/** Read one page of the Team card's people. */
export async function readTeamPeople(
  db: unknown,
  tables: TeamPeopleTables,
  { roleSlug, limit, now }: TeamPeopleOptions
): Promise<TeamPeoplePage> {
  const chain = db as QueryChain;
  const { users, userRoles, roles, refreshTokens, auditLog } = tables;

  // The person holds the role now: a lapsed assignment grants nothing, so it
  // does not put them under that role either.
  const holdsRole =
    roleSlug === undefined
      ? undefined
      : exists(
          chain
            .select({ one: sql`1` })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(
              and(
                eq(userRoles.userId, users.id),
                eq(roles.slug, roleSlug),
                roleAssignmentInForce(userRoles, now)
              )
            ) as unknown as SQL
        );

  const [counted] = await chain
    .select({ value: count() })
    .from(users)
    .where(holdsRole);
  const total = Number(counted?.value ?? 0);
  if (total === 0 || limit <= 0) return { people: [], total };

  // Each person's two last-active readings, by the tables' user indexes, as
  // correlated subqueries built by the query builder. Written as raw SQL in a
  // one-table select, drizzle would print their columns unqualified, and
  // `user_id = id` would compare the inner table with itself. The decoders
  // are the columns', so each comes back a Date on every dialect.
  const sessionAt = sql`${chain
    .select({ at: max(refreshTokens.createdAt) })
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, users.id))}`
    .mapWith(refreshTokens.createdAt)
    .as("session_at");
  const signInAt = sql`${chain
    .select({ at: max(auditLog.createdAt) })
    .from(auditLog)
    .where(
      and(eq(auditLog.actorUserId, users.id), eq(auditLog.kind, SIGN_IN_KIND))
    )}`
    .mapWith(auditLog.createdAt)
    .as("sign_in_at");
  const people = chain
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      sessionAt,
      signInAt,
    })
    .from(users)
    .where(holdsRole)
    .as("team_people") as unknown as Record<
    "id" | "name" | "sessionAt" | "signInAt",
    SQL
  >;

  const lastActive = laterOf(people.sessionAt, people.signInAt);
  const page = await chain
    .select()
    .from(people)
    .orderBy(
      // Everyone with a known last active first, newest first; then by name
      // and id, so people with the same reading keep one order.
      sql`CASE WHEN ${lastActive} IS NULL THEN 1 ELSE 0 END`,
      desc(lastActive),
      asc(people.name),
      asc(people.id)
    )
    .limit(limit);

  const rolesOf = await heldRoles(
    chain,
    tables,
    page.map(row => String(row.id)),
    now
  );

  return {
    total,
    people: page.map(row => {
      const id = String(row.id);
      const held = rolesOf.get(id) ?? [];
      const role =
        (roleSlug === undefined
          ? undefined
          : held.find(each => each.slug === roleSlug)) ?? held[0];
      const lastActiveAt = later(asDate(row.sessionAt), asDate(row.signInAt));
      return {
        id,
        name: typeof row.name === "string" ? row.name : null,
        email: String(row.email),
        ...(role === undefined ? {} : { role }),
        ...(lastActiveAt === undefined ? {} : { lastActiveAt }),
      };
    }),
  };
}

/**
 * The roles each of `userIds` holds now, highest level first, in one
 * statement for the whole page.
 */
async function heldRoles(
  chain: QueryChain,
  { userRoles, roles }: TeamPeopleTables,
  userIds: readonly string[],
  now: Date
): Promise<Map<string, { slug: string; name: string }[]>> {
  const held = new Map<string, { slug: string; name: string }[]>();
  if (userIds.length === 0) return held;
  const rows = await chain
    .select({
      userId: userRoles.userId,
      slug: roles.slug,
      name: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        inArray(userRoles.userId, [...userIds]),
        roleAssignmentInForce(userRoles, now)
      )
    )
    .orderBy(desc(roles.level), asc(roles.name));
  for (const row of rows) {
    const userId = String(row.userId);
    const list = held.get(userId) ?? [];
    list.push({ slug: String(row.slug), name: String(row.name) });
    held.set(userId, list);
  }
  return held;
}
