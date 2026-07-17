// KEPT DELIBERATELY IN TRIPLICATE with mysql/postgres/sqlite siblings:
// the edge map is structurally identical across dialects, but each copy
// is typed against ITS dialect's table set (RelationsBuilder<Tables>),
// which is what catches a column/table mismatch at compile time instead
// of at runtime on one dialect only. A shared generic builder erases
// that check. When adding an edge, add it to all three files — the
// relations round-trip tests fail per dialect if a copy is missed.
/**
 * Drizzle v2 relations for the MySQL dialect bundle.
 *
 * One central `defineRelations` per dialect replaces the per-feature
 * `<feature>/mysql-relations.ts` files (drizzle v1 removed the
 * `relations()` API those files used). Every edge here is a 1:1 port of
 * the deleted files' definitions — none dropped, none invented.
 *
 * v2 syntax notes:
 * - `fields`/`references` became `from`/`to`.
 * - A bare `r.many.X()` infers its join from the single reverse
 *   `r.one` on X. Three manys have NO reverse one (userPermissionCache,
 *   media←mediaFolders) or are ambiguous (self-joins), so they carry
 *   explicit `from`/`to` or a matching `alias`.
 * - `relationName` became `alias` — the string pairs a one with the
 *   many that reverses it when several edges connect the same tables
 *   (role inheritance's parent/child, media folders' subfolder tree).
 *
 * The edge builder is exported separately so SchemaRegistry can compose
 * these static edges with dynamic-entity edges (`creator → users` per
 * registered collection/single) into ONE defineRelations call at runtime.
 *
 * @module schemas/_dialect-bundles/mysql.relations
 */

import { defineRelations } from "drizzle-orm";
import type { ExtractTablesFromSchema, RelationsBuilder } from "drizzle-orm";

import * as tables from "./mysql";

type MysqlTables = ExtractTablesFromSchema<typeof tables>;

export const buildMysqlEdges = (r: RelationsBuilder<MysqlTables>) => ({
  users: {
    accounts: r.many.accounts(),
    sessions: r.many.sessions(),
    refreshTokens: r.many.refreshTokens(),
    userRoles: r.many.userRoles(),
    // No reverse one() exists on userPermissionCache — explicit columns.
    permissionCache: r.many.userPermissionCache({
      from: r.users.id,
      to: r.userPermissionCache.userId,
    }),
    apiKeys: r.many.apiKeys(),
    activityLogs: r.many.activityLog(),
  },
  accounts: {
    user: r.one.users({ from: r.accounts.userId, to: r.users.id }),
  },
  sessions: {
    user: r.one.users({ from: r.sessions.userId, to: r.users.id }),
  },
  refreshTokens: {
    user: r.one.users({ from: r.refreshTokens.userId, to: r.users.id }),
  },
  apiKeys: {
    user: r.one.users({ from: r.apiKeys.userId, to: r.users.id }),
    role: r.one.roles({ from: r.apiKeys.roleId, to: r.roles.id }),
  },
  activityLog: {
    user: r.one.users({ from: r.activityLog.userId, to: r.users.id }),
  },
  roles: {
    rolePermissions: r.many.rolePermissions(),
    userRoles: r.many.userRoles(),
    apiKeys: r.many.apiKeys(),
    // Role-inheritance self-join: two edges between the same pair of
    // tables, disambiguated by alias (was relationName pre-v1).
    childInherits: r.many.roleInherits({ alias: "parentRole" }),
    parentInherits: r.many.roleInherits({ alias: "childRole" }),
  },
  permissions: {
    rolePermissions: r.many.rolePermissions(),
  },
  rolePermissions: {
    role: r.one.roles({ from: r.rolePermissions.roleId, to: r.roles.id }),
    permission: r.one.permissions({
      from: r.rolePermissions.permissionId,
      to: r.permissions.id,
    }),
  },
  userRoles: {
    user: r.one.users({ from: r.userRoles.userId, to: r.users.id }),
    role: r.one.roles({ from: r.userRoles.roleId, to: r.roles.id }),
  },
  roleInherits: {
    parentRole: r.one.roles({
      from: r.roleInherits.parentRoleId,
      to: r.roles.id,
      alias: "parentRole",
    }),
    childRole: r.one.roles({
      from: r.roleInherits.childRoleId,
      to: r.roles.id,
      alias: "childRole",
    }),
  },
  media: {
    uploader: r.one.users({ from: r.media.uploadedBy, to: r.users.id }),
  },
  mediaFolders: {
    createdByUser: r.one.users({
      from: r.mediaFolders.createdBy,
      to: r.users.id,
    }),
    // Folder-tree self-join, alias-paired with `subfolders` below.
    parentFolder: r.one.mediaFolders({
      from: r.mediaFolders.parentId,
      to: r.mediaFolders.id,
      alias: "subfolders",
    }),
    subfolders: r.many.mediaFolders({ alias: "subfolders" }),
    // No reverse one() exists on media for its folder — explicit columns.
    mediaFiles: r.many.media({
      from: r.mediaFolders.id,
      to: r.media.folderId,
    }),
  },
  dynamicCollections: {
    creator: r.one.users({
      from: r.dynamicCollections.createdBy,
      to: r.users.id,
    }),
  },
});

export const relations = defineRelations(tables, buildMysqlEdges);
