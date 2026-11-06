/**
 * The super-admin role's slug.
 *
 * Whether a caller holds the role is decided from their actor, which reads
 * the roles a lookup finds (`auth/access/resolve-actor`); role names on a
 * caller handed in by server code grant nothing.
 *
 * @module services/access/super-admin
 */

/** Role slug that grants the full access-gate bypass. */
export const SUPER_ADMIN_SLUG = "super-admin";
