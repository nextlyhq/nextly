/**
 * The Public role: the built-in role every visitor is judged by.
 *
 * A visitor holds exactly what Public holds, so Public is never anyone's role
 * and never part of another role's inheritance: given to a person or a key it
 * would hand them visitors' grants as their own, and joined to inheritance it
 * would hand visitors another role's grants, or lend its own to that role.
 *
 * @module domains/auth/services/public-role
 */
import { randomUUID } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";

import { getDialectTables } from "../../../database";
import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../services/shared";
import type { LastSuperAdminTx } from "../../users/services/last-super-admin";

/** The slug the Public role is stored under, which no other role may hold. */
export const PUBLIC_ROLE_SLUG = "public";

/**
 * The `nextly_meta` key recording that boot seeding has made the Public role,
 * moving a site's own role off its slug first where one held it.
 */
export const PUBLIC_ROLE_META_KEY = "public-role-created";

/**
 * Refuses, as a built-in role's refusal, a change that would give the Public
 * role to someone (`assign`) or join it to inheritance (`inherit`), when any
 * of `roleIds` is the Public role. Read on `db`, by the dialect it reads.
 */
export async function refuseLinkingPublicRole(
  db: LastSuperAdminTx,
  dialect: SupportedDialect,
  roleIds: readonly string[],
  change: "assign" | "inherit",
  logContext: Record<string, unknown>
): Promise<void> {
  if (roleIds.length === 0) return;
  const { roles } = getDialectTables(dialect);
  const found = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        inArray(roles.id, Array.from(new Set(roleIds))),
        eq(roles.slug, PUBLIC_ROLE_SLUG)
      )
    )
    .limit(1);
  if (found.length === 0) return;
  throw NextlyError.builtIn({
    thing: "role",
    change,
    logContext: { ...logContext, reason: `public-role-${change}-refused` },
  });
}

/** What {@link seedPublicRole} needs of the role service and `nextly_meta`. */
interface PublicRoleSeeding {
  /** Makes the Public role where it does not exist yet. */
  ensurePublicRole: () => Promise<unknown>;
  /** Moves whatever role holds the slug off it; the slug it now has. */
  moveRoleOffPublicSlug: () => Promise<string | null>;
  meta: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    insertIfAbsent(key: string, value: unknown): Promise<void>;
    compareAndSet(
      key: string,
      expected: unknown,
      next: unknown
    ): Promise<boolean>;
  };
  logger: Logger;
}

/** The value of {@link PUBLIC_ROLE_META_KEY} once the Public role is made. */
const MADE = "created";

/**
 * A boot's claim on making the Public role: who, since when, and whether the
 * site's own role has been moved off the slug yet.
 */
interface Claim {
  claim: string;
  at: string;
  moved?: true;
}

/** How long a claim stands before another boot may take it over. */
const CLAIM_LAPSES_AFTER_MS = 5 * 60_000;

const isClaim = (value: unknown): value is Claim =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Claim).claim === "string" &&
  typeof (value as Claim).at === "string";

/**
 * Makes the Public role, once per install. Before this release no role was
 * built in under the slug, so on the first run whatever role holds it is a
 * role of the site's own, built-in mark or not: it is moved to the next free
 * `public-<n>` first, and the move is logged with what a code rule naming the
 * slug must now check. The first run is claimed in `nextly_meta`, so of two
 * boots starting together only one moves anything; a claim left by a boot
 * that stopped part-way lapses and is taken over, keeping whether the move
 * was made. Every later run only makes sure the Public role exists.
 */
export async function seedPublicRole({
  ensurePublicRole,
  moveRoleOffPublicSlug,
  meta,
  logger,
}: PublicRoleSeeding): Promise<void> {
  const state = await meta.get<unknown>(PUBLIC_ROLE_META_KEY);
  if (state === MADE) {
    await ensurePublicRole();
    return;
  }
  const mine: Claim = { claim: randomUUID(), at: new Date().toISOString() };
  if (state === null) {
    await meta.insertIfAbsent(PUBLIC_ROLE_META_KEY, mine);
  } else if (
    isClaim(state) &&
    Date.now() - Date.parse(state.at) > CLAIM_LAPSES_AFTER_MS
  ) {
    await meta.compareAndSet(
      PUBLIC_ROLE_META_KEY,
      state,
      state.moved ? { ...mine, moved: true } : mine
    );
  }
  const holder = await meta.get<unknown>(PUBLIC_ROLE_META_KEY);
  if (holder === MADE) {
    await ensurePublicRole();
    return;
  }
  // Another boot is making it; the next boot makes sure it exists.
  if (!isClaim(holder) || holder.claim !== mine.claim) return;

  if (!holder.moved) {
    const moved = await moveRoleOffPublicSlug();
    if (moved) {
      logger.warn(
        `A role of this site's own had the slug "${PUBLIC_ROLE_SLUG}", which the built-in Public role now holds, so it was moved to "${moved}". Its name, holders, permissions and inheritance are unchanged. Code access rules that check the role slug \`${PUBLIC_ROLE_SLUG}\` must now check \`${moved}\`.`
      );
    }
    // Recorded before the Public role is made, so a boot taking over after a
    // stop past this point does not move the role made here as a site's own.
    const recorded = { ...holder, moved: true as const };
    if (!(await meta.compareAndSet(PUBLIC_ROLE_META_KEY, holder, recorded))) {
      return;
    }
  }
  await ensurePublicRole();
  await meta.set(PUBLIC_ROLE_META_KEY, MADE);
}
