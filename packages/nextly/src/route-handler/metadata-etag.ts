/**
 * The "unchanged" answer for the admin's metadata reads: an entity tag made
 * from the versions the answer depends on, so a caller that sends the tag of
 * what it holds (`If-None-Match`) is told `304 Not Modified`, decided before
 * the read runs, instead of being sent the same schema again.
 *
 * Only the reads whose answer is the schema as one caller may see it are
 * tagged ({@link METADATA_READS}): the collection, Single and field group
 * lists and schemas. Each such answer is made from:
 * - the registry rows, which the schema version (`seq`) follows: every write
 *   of them moves it, on whichever server copy;
 * - what the caller may read, which the permission version (the RBAC epoch)
 *   follows, and who the caller is (person or key, and a session's claims,
 *   which a rule may read). An assignment's expiry moves neither version, so
 *   the roles in force for the caller now, and the soonest expiry among
 *   them, are part of it too: read through the permission layer's own cache
 *   (`resolveUserRoles`), which keeps them no longer than that expiry;
 * - the running configuration (plugins' admin views, the "removed from code"
 *   marks), which changes only with a new configuration: a deploy, or a
 *   development reload, each a new configuration object here;
 * - the request itself: its path, its query and its language.
 * The tag hashes all of them, so it names none of them, and a tag one caller
 * holds never answers another's request.
 *
 * Nothing is tagged where a version is unknown: the schema version not yet
 * read, or a permission version this process cannot trust
 * (`epochIsTrustworthy`). The answer is then sent in full, as before.
 *
 * @module route-handler/metadata-etag
 */
import { createHash, randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/middleware";
import { resolveUserRoles } from "../services/lib/permissions";
import {
  currentEpoch,
  epochIsTrustworthy,
  refreshEpoch,
} from "../services/lib/rbac-epoch";

/**
 * The metadata reads an "unchanged" answer may stand for, as
 * `<service>.<method>`: each answers with schema the caller may read, and
 * nothing else that changes between versions.
 */
const METADATA_READS: ReadonlySet<string> = new Set([
  "collections.listCollections",
  "collections.getCollection",
  "singles.listSingles",
  "singles.getSingleSchema",
  "field-groups.listComponents",
  "field-groups.getComponent",
]);

/**
 * An identity per running configuration object, so a new configuration (a
 * development reload) never matches a tag made under the previous one.
 */
const configIdentity = new WeakMap<object, string>();
/** The identity used while no configuration is stored. */
const NO_CONFIG = randomUUID();

function identityOf(config: object | null): string {
  if (config === null) return NO_CONFIG;
  let identity = configIdentity.get(config);
  if (identity === undefined) {
    identity = randomUUID();
    configIdentity.set(config, identity);
  }
  return identity;
}

/** What a metadata read's tag is made from, beyond the request. */
export interface MetadataTagInputs {
  service: string;
  method: string;
  /** The authenticated caller; a read for nobody is not tagged. */
  caller: AuthContext | undefined;
  /** The schema version this copy serves (`servedSchemaVersion`). */
  schemaVersion: number | undefined;
  /** The running configuration (`getHandlerConfig`). */
  config: object | null;
}

/**
 * The entity tag for `req`, a metadata read, or undefined where the read is
 * not one {@link METADATA_READS} names or a version it depends on is unknown.
 * Asked after the caller is authenticated and authorized, never before: the
 * "unchanged" answer is an answer, and the gate decides who gets one.
 */
export async function metadataEtag(
  req: Request,
  inputs: MetadataTagInputs
): Promise<string | undefined> {
  const { service, method, caller, schemaVersion, config } = inputs;
  if (req.method !== "GET") return undefined;
  if (!METADATA_READS.has(`${service}.${method}`)) return undefined;
  if (caller === undefined || schemaVersion === undefined) return undefined;
  let permissionVersion: string;
  let roles: { roleIds: string[]; validUntil: number | undefined };
  try {
    await refreshEpoch();
    if (!epochIsTrustworthy()) return undefined;
    permissionVersion = currentEpoch();
    // The roles in force now: one that lapsed since a tag was made is gone
    // from this, so that tag no longer matches.
    const resolved = await resolveUserRoles(caller.userId);
    roles = {
      roleIds: [...resolved.roleIds].sort(),
      validUntil: resolved.validUntil,
    };
  } catch {
    // The permission version or the roles could not be read: answered in full.
    return undefined;
  }
  const url = new URL(req.url);
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        schemaVersion,
        permissionVersion,
        caller.authMethod,
        caller.userId,
        caller.apiKeyId ?? null,
        caller.claims ?? null,
        // A key's own scope, and its maker's super-admin authority, are
        // decided per request: each is part of what the key may read.
        [...caller.permissions].sort(),
        caller.keyHoldsSuperAdmin ?? null,
        roles.roleIds,
        roles.validUntil ?? null,
        identityOf(config),
        url.pathname,
        url.search,
        req.headers.get("accept-language"),
      ])
    )
    .digest("base64url");
  // Weak: the same schema, though a date in it may be formatted afresh.
  return `W/"${digest.slice(0, 32)}"`;
}

/**
 * Whether the request's `If-None-Match` names `etag`, compared weakly as the
 * header is (RFC 9110, 13.1.2): any listed tag equal to it once a `W/`
 * prefix is set aside.
 *
 * `*` is not honoured. It means "any current answer exists", which the tag,
 * decided before the read runs, cannot say: a schema that does not exist, or
 * one this caller may not read, would be answered "unchanged" instead of
 * its 404. Such a request is answered in full.
 */
export function holdsCurrentTag(req: Request, etag: string): boolean {
  const header = req.headers.get("if-none-match");
  if (header === null) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const wanted = opaque(etag);
  return header.split(",").some(tag => opaque(tag) === wanted);
}
