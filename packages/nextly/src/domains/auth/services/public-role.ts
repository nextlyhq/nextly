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
  /** Moves a role of the site's own off the slug; the slug it now has. */
  moveRoleOffPublicSlug: () => Promise<string | null>;
  meta: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  logger: Logger;
}

/**
 * Makes the Public role, once per install. Where a role of the site's own
 * already holds the slug, it is moved to the next free `public-<n>` first,
 * the first time only, and the move is logged with what a code rule naming
 * the slug must now check. Every later run only makes sure Public exists.
 */
export async function seedPublicRole({
  ensurePublicRole,
  moveRoleOffPublicSlug,
  meta,
  logger,
}: PublicRoleSeeding): Promise<void> {
  const done = await meta.get<string>(PUBLIC_ROLE_META_KEY);
  if (!done) {
    const moved = await moveRoleOffPublicSlug();
    if (moved) {
      logger.warn(
        `A role of this site's own had the slug "${PUBLIC_ROLE_SLUG}", which the built-in Public role now holds, so it was moved to "${moved}". Its name, holders, permissions and inheritance are unchanged. Code access rules that check the role slug \`${PUBLIC_ROLE_SLUG}\` must now check \`${moved}\`.`
      );
    }
  }
  await ensurePublicRole();
  if (!done) await meta.set(PUBLIC_ROLE_META_KEY, new Date().toISOString());
}
