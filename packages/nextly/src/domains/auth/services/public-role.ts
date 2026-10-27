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
  /** The role holding the Public role's slug, and whether it is built in. */
  publicSlugHolder: () => Promise<{ id: string; builtIn: boolean } | null>;
  /**
   * Moves the role `id` off the slug where it still holds it, then clears
   * what is cached from its grants either way; the slug it now has, or
   * `null` where there is no such role.
   */
  moveRoleOffPublicSlug: (id: string) => Promise<string | null>;
  /** Makes the Public role where no role holds the slug. */
  ensurePublicRole: () => Promise<unknown>;
  /** Removes any inheritance link the Public role is part of. */
  unlinkPublicRole: () => Promise<void>;
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
 * A boot's claim on making the Public role: who, since when, the site's own
 * role it moves off the slug (`null` where none held it), recorded before the
 * move, and whether that move is done.
 */
interface Claim {
  claim: string;
  at: string;
  moving?: string | null;
  moved?: true;
}

/** How long a claim stands before another boot may take it over. */
const CLAIM_LAPSES_AFTER_MS = 5 * 60_000;

/** How many times a role of the site's own taking the slug is moved off it. */
const MOVES_ALLOWED = 3;

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
 * boots starting together only one moves anything. The role being moved is
 * recorded before the move and the move's completion after it, so a claim
 * left by a boot that stopped part-way lapses and is taken over where it
 * stopped: the move, with what it clears, is made again for that role rather
 * than skipped. A role the site makes on the slug meanwhile, not built in, is
 * moved off it too rather than taken for the Public role. Every later run only
 * makes sure the Public role exists.
 */
export async function seedPublicRole(
  seeding: PublicRoleSeeding
): Promise<PublicRoleSeeded> {
  const { ensurePublicRole, unlinkPublicRole, meta } = seeding;
  const state = await meta.get<unknown>(PUBLIC_ROLE_META_KEY);
  if (state === MADE) {
    await ensurePublicRole();
    await unlinkPublicRole();
    return { made: true };
  }
  const mine: Claim = { claim: randomUUID(), at: new Date().toISOString() };
  if (state === null) {
    await meta.insertIfAbsent(PUBLIC_ROLE_META_KEY, mine);
  } else if (
    isClaim(state) &&
    Date.now() - Date.parse(state.at) > CLAIM_LAPSES_AFTER_MS
  ) {
    // Taken over where the lapsed claim stopped.
    const { moving, moved } = state;
    await meta.compareAndSet(PUBLIC_ROLE_META_KEY, state, {
      ...mine,
      ...(moving !== undefined ? { moving } : {}),
      ...(moved ? { moved } : {}),
    });
  }
  const holder = await meta.get<unknown>(PUBLIC_ROLE_META_KEY);
  if (holder === MADE) {
    await ensurePublicRole();
    await unlinkPublicRole();
    return { made: true };
  }
  // Another boot is making it. Should that boot stop, its claim lapses, and
  // this one tries again then rather than waiting for the next start.
  if (!isClaim(holder) || holder.claim !== mine.claim) {
    return { made: false, retryAt: lapsesAt(holder) };
  }

  if (!(await moveSitesRole(seeding, holder))) {
    return { made: false, retryAt: lapsesAt(null) };
  }
  await makePublicRole(seeding);
  await meta.set(PUBLIC_ROLE_META_KEY, MADE);
  await unlinkPublicRole();
  return { made: true };
}

/**
 * Whether this boot found the Public role made, or made it; where another
 * boot holds the claim to make it, when that claim lapses and this boot is
 * to try again.
 */
export type PublicRoleSeeded =
  | { made: true }
  | { made: false; retryAt: number };

/**
 * When a claim lapses: `claim`'s own time and the lapse, or a lapse from now
 * where there is no claim to read it from.
 */
function lapsesAt(claim: unknown): number {
  const at = isClaim(claim) ? Date.parse(claim.at) : Number.NaN;
  return (Number.isNaN(at) ? Date.now() : at) + CLAIM_LAPSES_AFTER_MS + 1000;
}

/**
 * Moves the site's own role off the slug, recording which before the move
 * and that it is done after it. False where another boot took the claim over
 * meanwhile, which then carries on from what is recorded.
 */
async function moveSitesRole(
  seeding: PublicRoleSeeding,
  claim: Claim
): Promise<boolean> {
  const { publicSlugHolder, meta } = seeding;
  if (claim.moved) return true;
  let current = claim;
  if (current.moving === undefined) {
    const next = { ...current, moving: (await publicSlugHolder())?.id ?? null };
    if (!(await meta.compareAndSet(PUBLIC_ROLE_META_KEY, current, next))) {
      return false;
    }
    current = next;
  }
  if (current.moving) await moveAndSay(seeding, current.moving);
  return meta.compareAndSet(PUBLIC_ROLE_META_KEY, current, {
    ...current,
    moved: true,
  });
}

/**
 * Makes the Public role, and makes sure the role on the slug is built in: a
 * role the site made there since its own was moved is moved off it in turn.
 */
async function makePublicRole(seeding: PublicRoleSeeding): Promise<void> {
  const { ensurePublicRole, publicSlugHolder } = seeding;
  for (let moves = 0; ; moves++) {
    await ensurePublicRole();
    const onSlug = await publicSlugHolder();
    if (onSlug?.builtIn) return;
    if (onSlug === null || moves === MOVES_ALLOWED) {
      throw NextlyError.internal({
        logContext: { reason: "public-role-not-made", moves },
      });
    }
    await moveAndSay(seeding, onSlug.id);
  }
}

/** Moves role `id` off the slug, saying where to and what that changes. */
async function moveAndSay(
  { moveRoleOffPublicSlug, logger }: PublicRoleSeeding,
  id: string
): Promise<void> {
  const moved = await moveRoleOffPublicSlug(id);
  if (moved === null) return;
  logger.warn(
    `A role of this site's own had the slug "${PUBLIC_ROLE_SLUG}", which the built-in Public role now holds, so it was moved to "${moved}". Its name, holders, permissions and inheritance are unchanged. Code access rules that check the role slug \`${PUBLIC_ROLE_SLUG}\` must now check \`${moved}\`.`
  );
}

/**
 * Whether boot seeding has made the Public role and recorded it. Until then
 * the role on the slug may still be a site's own, waiting to be moved off it.
 */
export async function publicRoleMade(meta: {
  get<T>(key: string): Promise<T | null>;
}): Promise<boolean> {
  return (await meta.get<unknown>(PUBLIC_ROLE_META_KEY)) === MADE;
}
