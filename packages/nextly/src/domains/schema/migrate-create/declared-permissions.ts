/**
 * Every permission the configuration declares, by owner, as a migration
 * snapshot records them, and what changed between two records.
 *
 * A snapshot records the whole state `nextly migrate` writes from it, so the
 * permissions are recorded whole in every one, whatever its migration changed:
 *
 * - each collection's and Single's built-in permissions, and those a workflow
 *   attached to it adds, under the entity;
 * - the app's own declared permissions, under `app`;
 * - each installed plugin's, disabled ones included, under the plugin's name.
 *
 * Nextly's own fixed list (users, roles, media, settings and the rest) is not
 * recorded: it follows the Nextly release, as the preset roles' grants do, and
 * no grant is recorded either. Field groups declare no permission.
 *
 * Each permission is recorded with what the writer stores for it (its name,
 * description, group and danger flag), but only an app's or a plugin's
 * permission added or removed is a change of its own: a changed label travels
 * with the next migration, and an entity's built-in permissions follow the
 * entity, whose own change names it.
 *
 * @module domains/schema/migrate-create/declared-permissions
 */

import {
  collectCustomPermissions,
  type CollectedPermission,
} from "../../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { isSystemResource } from "../../../schemas/_zod/rbac";
import {
  builtInEntityPermissions,
  workflowEntityPermissions,
  type EntityPermission,
} from "../../auth/services/entity-permission-spelling";
import {
  workflowAttachmentsOf,
  type WorkflowAttachments,
} from "../../workflows/attachments";
import { WORKFLOW_PERMISSION_GROUP } from "../../workflows/permissions";

/** One permission as the snapshot records it: what the writer stores for it. */
export interface RecordedPermission {
  action: string;
  resource: string;
  name: string;
  description: string | null;
  group: string | null;
  danger: boolean;
}

/** One owner's permissions, by permission slug. */
export type OwnerPermissions = Record<string, RecordedPermission>;

/**
 * Every declared permission, by owner. Keyed rather than listed, so the file
 * reads the same whatever order the configuration declares them in.
 */
export interface PermissionRecord {
  app: OwnerPermissions;
  plugins: Record<string, OwnerPermissions>;
  collections: Record<string, OwnerPermissions>;
  singles: Record<string, OwnerPermissions>;
}

/**
 * A change a migration names: an app's or a plugin's permissions added or
 * removed, by slug; or, over a snapshot that predates the record, the first
 * record of them all, which names none as added, since that snapshot said
 * nothing about them.
 */
export type PermissionChange =
  | { kind: "owner"; owner: string; added: string[]; removed: string[] }
  | { kind: "recorded" };

/** What a record is built from. */
export interface DeclaredPermissionSources {
  /** Every collection the app's migrations hold: code-first, plugin and Schema Builder. */
  collections: readonly { slug: string }[];
  singles: readonly { slug: string }[];
  /** The configuration's workflows and what each is attached to (`workflowAttachmentsOf`). */
  workflows: readonly WorkflowAttachments[];
  /** The app's and the plugins' own permissions (`collectCustomPermissions`). */
  custom: readonly CollectedPermission[];
}

/** The owner key of the app's own permissions, as `collectCustomPermissions` names it. */
const APP_OWNER = "app";

/** `(action, resource)` as one key; permissions are identified by the pair. */
const identity = (p: { action: string; resource: string }) =>
  `${p.action.toLowerCase()}\u0000${p.resource.toLowerCase()}`;

function recorded(
  p: EntityPermission | CollectedPermission
): RecordedPermission {
  return {
    action: p.action,
    resource: p.resource,
    name: p.name,
    description: p.description ?? null,
    group: p.group ?? null,
    danger: "danger" in p ? p.danger : false,
  };
}

function bySlug(
  permissions: readonly (EntityPermission | CollectedPermission)[]
): OwnerPermissions {
  return Object.fromEntries(permissions.map(p => [p.slug, recorded(p)]));
}

/**
 * The record of every permission `sources` declare, built as the seeder seeds
 * them: an entity's built-in permissions are always its own, so another
 * owner's declaration of one is not recorded; a workflow's action an app or a
 * plugin declares stays theirs, so the entity records it no second time.
 */
export function permissionRecordOf(
  sources: DeclaredPermissionSources
): PermissionRecord {
  const entities = (kind: "collection" | "single") =>
    (kind === "collection" ? sources.collections : sources.singles)
      .map(entity => entity.slug)
      .filter(slug => !isSystemResource(slug));
  const builtIns = new Set(
    [
      ...entities("collection").flatMap(slug =>
        builtInEntityPermissions("collection", slug)
      ),
      ...entities("single").flatMap(slug =>
        builtInEntityPermissions("single", slug)
      ),
    ].map(identity)
  );
  const custom = sources.custom.filter(p => !builtIns.has(identity(p)));
  const claimed = new Set(custom.map(identity));
  const workflowOf = (kind: "collection" | "single", slug: string) =>
    sources.workflows.find(attachment =>
      (kind === "collection"
        ? attachment.collections
        : attachment.singles
      ).includes(slug)
    )?.workflow;
  const entityRecord = (kind: "collection" | "single") =>
    Object.fromEntries(
      entities(kind).map(slug => {
        const workflow = workflowOf(kind, slug);
        const added =
          workflow === undefined
            ? []
            : workflowEntityPermissions(slug, workflow).filter(
                p => !claimed.has(identity(p))
              );
        return [
          slug,
          bySlug([...builtInEntityPermissions(kind, slug), ...added]),
        ];
      })
    );
  const plugins: Record<string, CollectedPermission[]> = {};
  for (const p of custom) {
    if (p.source === "plugin") (plugins[p.owner] ??= []).push(p);
  }
  return {
    app: bySlug(custom.filter(p => p.source === "app")),
    plugins: Object.fromEntries(
      Object.entries(plugins).map(([owner, list]) => [owner, bySlug(list)])
    ),
    collections: entityRecord("collection"),
    singles: entityRecord("single"),
  };
}

/**
 * The record of what a loaded configuration declares, for `migrate:create`:
 * its workflows (`workflowAttachmentsOf`) and its own and its plugins'
 * permissions (`collectCustomPermissions`, disabled plugins included), with the
 * built-in permissions of `entities`, every collection and Single the app's
 * migrations hold, Schema Builder ones included.
 */
export function declaredPermissionsOf(
  config: Parameters<typeof collectCustomPermissions>[0] &
    Parameters<typeof workflowAttachmentsOf>[0] & {
      plugins?: readonly PluginDefinition[];
    },
  entities: Pick<DeclaredPermissionSources, "collections" | "singles">
): PermissionRecord {
  return permissionRecordOf({
    ...entities,
    workflows: workflowAttachmentsOf(config),
    custom: collectCustomPermissions(config, [...(config.plugins ?? [])]),
  });
}

/** The app's and each plugin's permissions, by owner: the ones a change names. */
function ownersOf(record: PermissionRecord): Map<string, OwnerPermissions> {
  const owners = new Map<string, OwnerPermissions>();
  if (Object.keys(record.app).length > 0) owners.set(APP_OWNER, record.app);
  for (const [owner, permissions] of Object.entries(record.plugins)) {
    owners.set(owner, permissions);
  }
  return owners;
}

/**
 * What changed in the app's and each plugin's declared permissions from
 * `previous` to `desired`, owner by owner in a stable order: the app, then
 * each plugin by name, each permission by slug.
 *
 * `previous` is `null` when there is no earlier snapshot, so every permission
 * is added, and `undefined` when the earlier snapshot predates the record: it
 * said nothing about permissions, so the run records them all as one change
 * rather than naming each as added. `desired` is `undefined` when the run knows no permissions, which
 * names nothing.
 */
export function permissionChanges(
  previous: PermissionRecord | null | undefined,
  desired: PermissionRecord | undefined
): PermissionChange[] {
  if (desired === undefined) return [];
  const after = ownersOf(desired);
  // Every snapshot from now on records them, so the first one over an earlier snapshot is a change
  // of its own, whoever declares them: the entities' built-in permissions are recorded too.
  if (previous === undefined) return [{ kind: "recorded" }];
  const before = previous === null ? new Map() : ownersOf(previous);
  return order([...new Set([...before.keys(), ...after.keys()])]).flatMap(
    owner => {
      const was = Object.keys(before.get(owner) ?? {});
      const now = Object.keys(after.get(owner) ?? {});
      const added = now.filter(slug => !was.includes(slug)).sort();
      const removed = was.filter(slug => !now.includes(slug)).sort();
      return added.length + removed.length === 0
        ? []
        : [{ kind: "owner" as const, owner, added, removed }];
    }
  );
}

/** The app first, then each plugin by name. */
function order(owners: string[]): string[] {
  return [
    ...owners.filter(owner => owner === APP_OWNER),
    ...owners.filter(owner => owner !== APP_OWNER).sort(),
  ];
}

/**
 * The record a `migrate:create` run writes, and the changes it names.
 *
 * Given a record, the run writes it and names what changed since `latest`'s.
 * A caller that knows no permissions (a Schema Builder save, which has the
 * entity it saves and not the configuration's plugins) gives none: the run
 * carries `latest`'s record forward, so the snapshot stays whole, with only the
 * saved entity's built-in permissions brought to what it now is, and names no
 * change, since nothing else is known to have moved. A `latest` with no record
 * gives a run like that none either: it said nothing about permissions.
 */
export function permissionsForRun(run: {
  given: PermissionRecord | undefined;
  /** The newest snapshot's record; `null` when there is no snapshot at all. */
  latest: PermissionRecord | null | undefined;
  /** The one entity a scoped run saves, and whether it is still declared. */
  scope?: {
    kind: "collection" | "single" | "fieldGroup";
    slug: string;
    present: boolean;
  };
}): { record: PermissionRecord | undefined; changes: PermissionChange[] } {
  if (run.given !== undefined) {
    return {
      record: run.given,
      changes: permissionChanges(run.latest, run.given),
    };
  }
  if (run.latest === null || run.latest === undefined) {
    return { record: undefined, changes: [] };
  }
  const { scope } = run;
  if (scope === undefined || scope.kind === "fieldGroup") {
    return { record: run.latest, changes: [] };
  }
  const key = scope.kind === "collection" ? "collections" : "singles";
  const entities = { ...run.latest[key] };
  if (!scope.present || isSystemResource(scope.slug)) {
    delete entities[scope.slug];
  } else {
    // A workflow's permissions are kept as recorded: a save names no workflow.
    const workflow = Object.fromEntries(
      Object.entries(entities[scope.slug] ?? {}).filter(
        ([, p]) => p.group === WORKFLOW_PERMISSION_GROUP
      )
    );
    entities[scope.slug] = {
      ...bySlug(builtInEntityPermissions(scope.kind, scope.slug)),
      ...workflow,
    };
  }
  return { record: { ...run.latest, [key]: entities }, changes: [] };
}

/** `@nextlyhq/plugin-form-builder: + export-submissions, - archive-submissions`. */
export function describePermissionChange(change: PermissionChange): string {
  if (change.kind === "recorded") return "every declared permission recorded";
  const each = [
    ...change.added.map(slug => `+ ${slug}`),
    ...change.removed.map(slug => `- ${slug}`),
  ];
  return `${change.owner}: ${each.join(", ")}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isRecordedPermission(value: unknown): boolean {
  if (!isObject(value)) return false;
  const { action, resource, name, description, group, danger } = value;
  return (
    typeof action === "string" &&
    typeof resource === "string" &&
    typeof name === "string" &&
    (description === null || typeof description === "string") &&
    (group === null || typeof group === "string") &&
    typeof danger === "boolean"
  );
}

const isOwnerPermissions = (value: unknown): boolean =>
  isObject(value) && Object.values(value).every(isRecordedPermission);

const isOwnerMap = (value: unknown): boolean =>
  isObject(value) && Object.values(value).every(isOwnerPermissions);

/** Structural check of a snapshot file's `permissions`, for the snapshot reader. */
export function isPermissionRecord(value: unknown): value is PermissionRecord {
  return (
    isObject(value) &&
    isOwnerPermissions(value.app) &&
    isOwnerMap(value.plugins) &&
    isOwnerMap(value.collections) &&
    isOwnerMap(value.singles)
  );
}
