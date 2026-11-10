/**
 * Fold plugin schema contributions into the merged config (code-first lane).
 *
 * Pure function: appends each plugin's `contributes.{collections,singles,
 * components}` to the config's own arrays so the downstream merge/migration/
 * sync machinery treats them like ordinary code-first entities. Runs
 * over ALL plugins — including disabled ones — so declarative schema stays
 * deterministic across environments.
 *
 * Slug collisions that involve a plugin-contributed entity are a fail-fast boot
 * error. Pre-existing code-vs-code duplicates are left untouched so the
 * plugin-free path is byte-for-byte unchanged (decisions doc G2). Collections,
 * singles and components share ONE slug namespace, across kinds as well as
 * within one: see {@link assertOneKindPerSlug}.
 *
 * Called at the same post-`setup` seam by both the runtime boot
 * (`di/register.ts`) and the CLI (`cli/utils/config-loader.ts`), which is what
 * keeps the two paths in agreement.
 *
 * @module plugins/schema/apply-contributions
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { AuthorableFieldConfig } from "../../collections/fields/types/plugin-field";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors";
import { assertNoLegacyFieldGroupKey } from "../../shared/legacy-field-group-key";
import {
  transformWithLedgers,
  type TransformContribution,
  type TransformableEntity,
  type TransformedEntities,
} from "../entity-transforms";
import {
  typesReachedBy,
  type ContentTypeCandidate,
  type ContentTypeScope,
} from "../content-type-scope";
import type { PluginDefinition } from "../plugin-context";
import {
  extendFieldDuplicateError,
  extendTargetUnknownError,
  renameUnknownTargetError,
  slugCollisionError,
} from "../schema-error";

import { tagPluginFields } from "./reconcile-builder-contributions";

type EntityKind = "collection" | "single" | "component";

type RenamedContributes = Pick<
  NonNullable<PluginDefinition["contributes"]>,
  "collections" | "singles" | "fieldGroups"
>;

interface Slugged {
  slug: string;
}

interface Fielded extends Slugged {
  fields?: FieldConfig[];
}

interface PluginEntry<T> {
  owner: string;
  entities: readonly T[] | undefined;
}

/**
 * The app's own config as the owner of a slug. A symbol rather than a name: a
 * plugin may be named anything, so a name set aside for the app is one a
 * plugin can take, and that plugin's entities would then be read as the app's.
 */
const APP: unique symbol = Symbol("app");

/** Who claims a slug: the app, or the name a plugin or registry goes by. */
type SlugOwner = typeof APP | string;

/** How an owner is named in a collision error. */
function ownerLabel(owner: SlugOwner): string {
  return owner === APP ? "code" : owner;
}

/**
 * Merge one entity kind: code entities first (owned by {@link APP}), then each
 * plugin's contributions in resolved order. Throws on any slug already owned
 * by a different source once a plugin is involved.
 */
function mergeKind<T extends Slugged>(
  kind: EntityKind,
  codeEntities: readonly T[],
  pluginEntries: ReadonlyArray<PluginEntry<T>>
): T[] {
  const merged: T[] = [...codeEntities];
  const owners = new Map<string, SlugOwner>();
  for (const entity of codeEntities) {
    // First code owner wins; pre-existing code-vs-code duplicates are not our
    // concern here (G2) — keep today's behavior.
    if (!owners.has(entity.slug)) owners.set(entity.slug, APP);
  }

  for (const { owner, entities } of pluginEntries) {
    for (const entity of entities ?? []) {
      const existing = owners.get(entity.slug);
      if (existing !== undefined) {
        throw slugCollisionError(kind, entity.slug, [
          ownerLabel(existing),
          owner,
        ]);
      }
      owners.set(entity.slug, owner);
      merged.push(entity);
    }
  }

  return merged;
}

/**
 * Append `fields` to the entity in `arr` whose slug is `target`, returning a NEW
 * array with the touched entity cloned (purity). Returns false if not found.
 */
/**
 * Narrow an `extend` clause's authored fields to the canonical union.
 *
 * `contributes.extend` is written inline, so it accepts a contributed field
 * type by name; from here on the pipeline reads the same closed shape as every
 * other field, a branded declaration being structurally one already.
 */
function asDeclaredFields(fields: AuthorableFieldConfig[]): FieldConfig[] {
  return fields as FieldConfig[];
}

function tryExtend<T extends Fielded>(
  arr: T[],
  target: string,
  fields: FieldConfig[],
  owner: string,
  leftAlone?: LeftAloneExtend[]
): boolean {
  const idx = arr.findIndex(e => e.slug === target);
  if (idx === -1) return false;
  const existing = arr[idx].fields ?? [];
  const seen = new Set(
    existing.map(f => (f as { name?: string }).name?.toLowerCase())
  );
  for (const f of fields) {
    const name = (f as { name?: string }).name;
    if (name && seen.has(name.toLowerCase())) {
      // A scope reaches types its author never named, so one that already has
      // a field of this name is left as it is and listed, rather than stopping
      // the boot over a type the plugin did not choose. A slug target names
      // the type on purpose, and still refuses.
      if (leftAlone === undefined) {
        throw extendFieldDuplicateError(target, name, owner);
      }
      leftAlone.push({ target, field: name, owner });
      return true;
    }
    if (name) seen.add(name.toLowerCase());
  }
  arr[idx] = { ...arr[idx], fields: [...existing, ...fields] };
  return true;
}

/**
 * Apply every plugin's `contributes.extend`: append the declared fields to
 * the target entity (found by slug across the merged collections/singles/
 * components). `target` may be a slug or an array of slugs (applied to each). An
 * unknown target fails fast. This is the EAGER form used by
 * `applyPluginSchemaContributions`; the Builder-aware boot paths instead use the
 * deferring fold so a Builder-made target is resolved later, not thrown here
 *. Pure: clones touched arrays.
 */
function applyExtends(
  collections: NextlyServiceConfig["collections"],
  singles: NextlyServiceConfig["singles"],
  fieldGroups: NextlyServiceConfig["fieldGroups"],
  plugins: PluginDefinition[],
  owners: ReadonlyMap<string, string>
): Pick<NextlyServiceConfig, "collections" | "singles" | "fieldGroups"> & {
  leftAlone: LeftAloneExtend[];
} {
  const r = applyExtendClauses(
    collections,
    singles,
    fieldGroups,
    flattenExtends(plugins),
    "throw",
    configuredScope(owners)
  );
  return {
    collections: r.collections,
    singles: r.singles,
    fieldGroups: r.fieldGroups,
    leftAlone: r.leftAlone,
  };
}

/**
 * A single, fully-resolved `extend` clause — one target slug (array targets are
 * pre-expanded) plus the name of the plugin that declared it. Returned by the
 * deferring fold for targets that aren't code/plugin entities (candidate Builder
 * targets, P8/R2), then resolved against the Builder set by `resolveBuilderExtends`.
 */
export interface DeferredExtend {
  /** A slug, or a scope the Builder's types are judged by once known. */
  target: string | ContentTypeScope;
  fields: FieldConfig[];
  owner: string;
  /**
   * For a scope: every slug the configuration holds, its own and plugins'.
   * The fold has already judged those, and the registry the Builder's types
   * are read from holds their rows too, so the Builder pass leaves them out.
   */
  configuredSlugs?: readonly string[];
}

/** A type a scope reached that already had a field of the same name. */
export interface LeftAloneExtend {
  target: string;
  field: string;
  owner: string;
}

/** Minimal shape an entity must have to be an extend target (slug + fields). */
export interface SchemaEntityLike {
  slug: string;
  fields?: FieldConfig[];
  /**
   * Who made a registry row: `ui` for the Schema Builder, `code` for the
   * configuration, `plugin:<name>` for a plugin. Absent on a ui-schema
   * manifest's entities, which are all the Builder's.
   */
  source?: string;
}

/** Builder/UI-schema entities that participate in extend resolution. */
export interface BuilderEntities {
  collections?: SchemaEntityLike[];
  singles?: SchemaEntityLike[];
  components?: SchemaEntityLike[];
}

/** Result of the deferring fold: the code+plugin merged config + unresolved extends. */
export interface FoldResult {
  config: NextlyServiceConfig;
  /** Extends whose target wasn't a code/plugin entity — resolved later. */
  deferredExtends: DeferredExtend[];
  /** The fields plugins added to entities they do not own, by the transforms' ledgers. */
  fieldsAddedByPlugins: FieldsAddedByPlugins;
  /** Configured types a scope left as they were, having a field of that name. */
  leftAlone: LeftAloneExtend[];
}

/** Flatten every plugin's `contributes.extend` into one clause per (target, plugin). */
/**
 * Run every plugin's `transforms` over the MERGED entity set.
 *
 * After the merge and after `extend`, because that is the first moment another
 * plugin's collections exist to be changed: `setup(config)` is handed a config
 * the merge has not happened in yet, which is why adding fields was possible
 * and changing an entity was not.
 *
 * In plugin order with no reordering of its own — `plugins` arrives
 * topologically sorted, so a plugin transforming a dependency's collection
 * sees it as the dependency left it.
 */
function applyTransforms(
  entities: Pick<
    NextlyServiceConfig,
    "collections" | "singles" | "fieldGroups"
  >,
  plugins: PluginDefinition[],
  owners: ReadonlyMap<string, string>,
  leftAlone: readonly LeftAloneExtend[]
): {
  entities: Pick<
    NextlyServiceConfig,
    "collections" | "singles" | "fieldGroups"
  >;
  fieldsAdded: FieldsAddedByPlugins;
} {
  const contributions: TransformContribution[] = plugins
    .filter(plugin => (plugin.contributes?.transforms?.length ?? 0) > 0)
    .map(plugin => ({
      source: `plugin:${plugin.name}`,
      name: plugin.name,
      // Required dependencies only, as `validateCrossPluginRelations` asks of
      // a relation to another plugin's entity: a transform needs the entity's
      // owner present, which an optional dependency does not promise.
      dependsOn: Object.keys(plugin.dependsOn ?? {}),
      transforms: plugin.contributes?.transforms ?? [],
      // Run all the same, so disabling the plugin never changes a table;
      // `runEntityTransforms` keeps its storage changes and drops its
      // behaviour.
      disabled: plugin.enabled === false,
    }));
  // Nothing to do, and nothing to rebuild: the arrays are returned untouched
  // so a config with no transforms is not re-created on every fold.
  if (contributions.length === 0) return { entities, fieldsAdded: new Map() };

  // The configured types each scope added its fields to: the ones it reaches,
  // less those it left alone for already having a field of that name.
  const untouched = new Set(leftAlone.map(left => left.target));
  const extendedBy = extendersBySlug(plugins, scope =>
    typesReachedBy(
      scope,
      scopeCandidates(
        entities.collections ?? [],
        entities.singles ?? [],
        entities.fieldGroups ?? [],
        configuredScope(owners),
        new Set()
      )
    )
      .map(type => type.slug)
      .filter(slug => !untouched.has(slug))
  );
  const transformable =
    (kind: TransformableEntity["kind"]) =>
    (entity: unknown): TransformableEntity => {
      const slug = (entity as { slug: string }).slug;
      return {
        slug,
        kind,
        definition: entity as Record<string, unknown>,
        owner: owners.get(slug),
        extendedBy: extendedBy.get(slug),
      };
    };
  const flat: TransformableEntity[] = [
    ...(entities.collections ?? []).map(transformable("collection")),
    ...(entities.singles ?? []).map(transformable("single")),
    ...(entities.fieldGroups ?? []).map(transformable("component")),
  ];

  const { entities: transformed, fieldContributors } = transformWithLedgers(
    flat,
    contributions
  );
  const of = (kind: TransformableEntity["kind"]): unknown[] =>
    transformed.filter(entity => entity.kind === kind).map(e => e.definition);

  return {
    entities: {
      collections: of("collection") as NextlyServiceConfig["collections"],
      singles: of("single") as NextlyServiceConfig["singles"],
      fieldGroups: of("component") as NextlyServiceConfig["fieldGroups"],
    },
    fieldsAdded: fieldsAddedFrom(transformed, fieldContributors),
  };
}

/**
 * Entity slug → field name path → the plugin that added the field to an
 * entity it does not own, by `extend` or by a transform: what goes with that
 * plugin when it is uninstalled. A field nested in a group or repeater is
 * keyed by its whole path (`settings.note`), as the ledgers name it, so one a
 * transform put inside another owner's group is told apart from that owner's
 * fields beside it. Read from the transforms' ownership ledgers, so empty
 * when no plugin declares a transform; `extend`'s fields are then read from
 * `extendersBySlug`.
 */
export type FieldsAddedByPlugins = ReadonlyMap<
  string,
  ReadonlyMap<string, string>
>;

/** The fields, at any depth, a plugin declared on an entity it does not own, by the ledgers. */
function fieldsAddedFrom(
  entities: readonly TransformableEntity[],
  contributors: TransformedEntities["fieldContributors"]
): FieldsAddedByPlugins {
  const added = new Map<string, Map<string, string>>();
  for (const entity of entities) {
    const fields =
      contributors.get(`${entity.kind}\u0000${entity.slug}`) ?? new Map();
    for (const [path, by] of fields) {
      if (by === undefined || by === entity.owner) continue;
      const onEntity = added.get(entity.slug) ?? new Map<string, string>();
      onEntity.set(path, by);
      added.set(entity.slug, onEntity);
    }
  }
  return added;
}

/**
 * Target slug → field name → the plugin whose `extend` added the field: who
 * declared each field the transforms are handed, beside the entity's owner,
 * and which fields a full uninstall of that plugin takes with it.
 */
export function extendersBySlug(
  plugins: PluginDefinition[],
  reach?: (scope: ContentTypeScope) => readonly string[]
): Map<string, Map<string, string>> {
  const bySlug = new Map<string, Map<string, string>>();
  for (const { target, fields, owner } of flattenExtends(plugins)) {
    // A scope names no slug of its own: the types it reached are the caller's
    // to say, from the entities it holds. Without them it records nothing,
    // so a full uninstall keeps those fields' columns rather than guessing.
    const slugs = typeof target === "string" ? [target] : (reach?.(target) ?? []);
    for (const slug of slugs) {
      const names = bySlug.get(slug) ?? new Map<string, string>();
      for (const field of fields) {
        const name = (field as { name?: unknown }).name;
        if (typeof name === "string") names.set(name, owner);
      }
      bySlug.set(slug, names);
    }
  }
  return bySlug;
}

function flattenExtends(plugins: PluginDefinition[]): DeferredExtend[] {
  const clauses: DeferredExtend[] = [];
  for (const plugin of plugins) {
    for (const clause of plugin.contributes?.extend ?? []) {
      const targets =
        typeof clause.target === "string" || Array.isArray(clause.target)
          ? [clause.target].flat()
          : [clause.target];
      for (const target of targets) {
        clauses.push({
          target,
          fields: asDeclaredFields(clause.fields),
          owner: plugin.name,
        });
      }
    }
  }
  return clauses;
}

/**
 * Who each entity a scope may reach belongs to, for the arrays at hand.
 *
 * The fold reads the configuration, where a plugin's types are known by the
 * merge's owners; the Builder pass reads registry rows or the ui-schema
 * manifest, where the configuration's own rows sit beside the Builder's.
 */
export interface ScopeContext {
  /** The plugin that contributed a type, or undefined for the site's own. */
  pluginOf: (entity: SchemaEntityLike) => string | undefined;
  /** Whether a scope is also kept for the Builder pass, once its types are known. */
  defer: boolean;
}

/** The fold's view: a type's plugin is the one the merge recorded for its slug. */
function configuredScope(owners: ReadonlyMap<string, string>): ScopeContext {
  return { pluginOf: entity => owners.get(entity.slug), defer: false };
}

/**
 * The Builder pass's view. Only a row the Schema Builder made is the site's to
 * reach: the configuration's rows were judged by the fold, and a plugin's row
 * stays its plugin's even once the plugin is gone.
 */
const BUILDER_SCOPE: ScopeContext = {
  pluginOf: entity =>
    entity.source === undefined || entity.source === "ui"
      ? undefined
      : entity.source,
  defer: false,
};

/** The candidates a scope judges, from the three arrays, in their order. */
function scopeCandidates(
  collections: readonly SchemaEntityLike[],
  singles: readonly SchemaEntityLike[],
  fieldGroups: readonly SchemaEntityLike[],
  context: ScopeContext,
  configured: ReadonlySet<string>
): ContentTypeCandidate[] {
  const of = (
    entities: readonly SchemaEntityLike[],
    kind: ContentTypeCandidate["kind"]
  ): ContentTypeCandidate[] =>
    entities
      .filter(entity => !configured.has(entity.slug))
      .map(entity => {
        const plugin = context.pluginOf(entity);
        return {
          slug: entity.slug,
          kind,
          ...(plugin === undefined ? {} : { plugin }),
        };
      });
  return [
    ...of(collections, "collection"),
    ...of(singles, "single"),
    ...of(fieldGroups, "fieldGroup"),
  ];
}

/**
 * Apply a flat list of extend clauses to the three entity arrays (matched by slug
 * across all three). Pure: clones touched arrays. A clause whose target is not
 * found is either thrown (`onUnknown: "throw"`, D12) or collected into `deferred`
 * (`onUnknown: "collect"`) — the latter holds a target that may be a Builder
 * entity until Builder slugs are known.
 *
 * A scope target is applied to every type in the arrays it reaches, judged by
 * `context`, and is never unknown. With `context.defer` it is also returned in
 * `deferred`, carrying the slugs judged here, for the Builder pass.
 */
export function applyExtendClauses<
  C extends Fielded,
  S extends Fielded,
  P extends Fielded,
>(
  collections: C[] | undefined,
  singles: S[] | undefined,
  fieldGroups: P[] | undefined,
  clauses: DeferredExtend[],
  onUnknown: "throw" | "collect",
  context: ScopeContext = BUILDER_SCOPE
): {
  collections: C[];
  singles: S[];
  fieldGroups: P[];
  deferred: (DeferredExtend & { target: string })[];
  scopes: DeferredExtend[];
  leftAlone: LeftAloneExtend[];
} {
  const cols = [...(collections ?? [])];
  const sin = [...(singles ?? [])];
  const comp = [...(fieldGroups ?? [])];
  const deferred: (DeferredExtend & { target: string })[] = [];
  const scopes: DeferredExtend[] = [];
  const leftAlone: LeftAloneExtend[] = [];
  for (const clause of clauses) {
    const { target, fields, owner } = clause;
    if (typeof target !== "string") {
      const candidates = scopeCandidates(
        cols,
        sin,
        comp,
        context,
        new Set(clause.configuredSlugs ?? [])
      );
      for (const reached of typesReachedBy(target, candidates)) {
        if (reached.kind === "collection") {
          tryExtend(cols, reached.slug, fields, owner, leftAlone);
        } else {
          tryExtend(sin, reached.slug, fields, owner, leftAlone);
        }
      }
      if (context.defer) {
        scopes.push({
          target,
          fields,
          owner,
          configuredSlugs: [...cols, ...sin, ...comp].map(e => e.slug),
        });
      }
      continue;
    }
    const applied =
      tryExtend(cols, target, fields, owner) ||
      tryExtend(sin, target, fields, owner) ||
      tryExtend(comp, target, fields, owner);
    if (!applied) {
      if (onUnknown === "throw") throw extendTargetUnknownError(target, owner);
      deferred.push({ target, fields, owner });
    }
  }
  return {
    collections: cols,
    singles: sin,
    fieldGroups: comp,
    deferred,
    scopes,
    leftAlone,
  };
}

/**
 * Rewrite relationship `relationTo` through the rename map, recursing into the
 * nested `fields` of container fields (`group`/`repeater`) so a plugin's own
 * relations follow the rename wherever they are declared, not just at the top
 * level. `group` and `repeater` are the only field-builder containers
 * that nest other fields.
 */
function rewriteRelations(
  fields: FieldConfig[] | undefined,
  map: Record<string, string>
): FieldConfig[] | undefined {
  if (!fields) return fields;
  const resolve = (target: string) => map[target] ?? target;
  return fields.map(field => {
    const f = field as {
      type?: string;
      relationTo?: string | string[];
      fields?: FieldConfig[];
    };
    if (
      (f.type === "group" || f.type === "repeater") &&
      Array.isArray(f.fields)
    ) {
      return {
        ...field,
        fields: rewriteRelations(f.fields, map),
      } as FieldConfig;
    }
    if (f.type !== "relationship" || f.relationTo == null) return field;
    const relationTo = Array.isArray(f.relationTo)
      ? f.relationTo.map(resolve)
      : resolve(f.relationTo);
    return { ...field, relationTo } as FieldConfig;
  });
}

/** Clone an entity with its slug renamed + own `relationTo` references rewritten. */
function renameEntity<T extends Fielded>(
  entity: T,
  map: Record<string, string>
): T {
  return {
    ...entity,
    slug: map[entity.slug] ?? entity.slug,
    fields: rewriteRelations(entity.fields, map),
  };
}

/**
 * Rejects a plugin still contributing under the pre-rename key.
 *
 * The key was renamed rather than aliased, so a plugin compiled against the old
 * name would otherwise load cleanly and have its entities dropped without a
 * word. Failing here turns a silent loss of schema into a startup error naming
 * the plugin.
 */
function assertNoLegacyContributesKey(
  pluginName: string,
  contributes: PluginDefinition["contributes"]
): void {
  if (!contributes) return;
  const legacy = (contributes as { components?: unknown }).components;
  if (legacy === undefined) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "contributes.components",
        code: "PLUGIN_CONTRIBUTES_RENAMED",
        message:
          `Plugin '${pluginName}' contributes 'components', which is now ` +
          `'fieldGroups'. Rename the key: the old one is no longer read.`,
      },
    ],
    logContext: {
      reason: "plugin-contributes-legacy-field-group-key",
      plugin: pluginName,
    },
  });
}

/**
 * Apply a plugin's `renameMap`: rename its contributed entity slugs and
 * rewrite its OWN internal `relationTo` to the renamed slugs (a target that is
 * not a renamed own slug is left untouched). Validates every rename key is a
 * contributed slug, else `NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET`. Pure; returns
 * the plugin's declared contributes unchanged when there is no rename map.
 * Exported so a full uninstall names the plugin's entities as the fold
 * stored them.
 */
export function renamePluginContributes(
  plugin: PluginDefinition
): RenamedContributes {
  const contributes = plugin.contributes;
  assertNoLegacyContributesKey(plugin.name, contributes);
  const map = plugin.renameMap;
  if (!contributes || !map || Object.keys(map).length === 0) {
    return {
      collections: contributes?.collections,
      singles: contributes?.singles,
      fieldGroups: contributes?.fieldGroups,
    };
  }

  const ownSlugs = new Set<string>([
    ...(contributes.collections ?? []).map(e => e.slug),
    ...(contributes.singles ?? []).map(e => e.slug),
    ...(contributes.fieldGroups ?? []).map(e => e.slug),
  ]);
  for (const key of Object.keys(map)) {
    if (!ownSlugs.has(key)) throw renameUnknownTargetError(key, plugin.name);
  }

  return {
    collections: contributes.collections?.map(e => renameEntity(e, map)),
    singles: contributes.singles?.map(e => renameEntity(e, map)),
    fieldGroups: contributes.fieldGroups?.map(e => renameEntity(e, map)),
  };
}

/** One entity's claim on the slug namespace. */
interface SlugClaim<Owner extends SlugOwner = SlugOwner> {
  slug: string;
  kind: EntityKind;
  /** {@link APP} for the config's own entities, else who contributed it. */
  owner: Owner;
}

/** One kind's entities as claims on the namespace, from one owner. */
function claimsOfKind<Owner extends SlugOwner>(
  kind: EntityKind,
  owner: Owner,
  entities: readonly Slugged[] | undefined
): SlugClaim<Owner>[] {
  return (entities ?? []).map(entity => ({ slug: entity.slug, kind, owner }));
}

/** The config's own entities as claims, each owned by {@link APP}. */
function appClaims(
  config: Pick<NextlyServiceConfig, "collections" | "singles" | "fieldGroups">
): SlugClaim[] {
  return [
    ...claimsOfKind("collection", APP, config.collections),
    ...claimsOfKind("single", APP, config.singles),
    ...claimsOfKind("component", APP, config.fieldGroups),
  ];
}

/** Each plugin's renamed contributions as claims, in resolved order. */
function pluginClaims(
  renamed: ReadonlyArray<{ owner: string; contributes: RenamedContributes }>
): SlugClaim<string>[] {
  return renamed.flatMap(({ owner, contributes }) => [
    ...claimsOfKind("collection", owner, contributes.collections),
    ...claimsOfKind("single", owner, contributes.singles),
    ...claimsOfKind("component", owner, contributes.fieldGroups),
  ]);
}

/**
 * One slug, one kind, wherever a plugin is involved.
 *
 * 🔴 Collections, singles and components are ONE slug namespace, and the rest
 * of the platform reads them that way: `defineConfig` refuses a slug two kinds
 * share in the app's own config, the registries refuse to register a slug the
 * other kind already holds, a permission is named `read-<slug>` for either
 * kind, code-defined access is resolved by the slug alone, and an `extend`
 * target is matched by slug across all three. {@link mergeKind} checks within
 * a kind, so a plugin contributing a collection under an app single's slug
 * passed this fold -- and at sync the registry refused the single, the
 * install booted without it, and its reads answered not-found under the
 * collection's rule.
 *
 * The same scope as `mergeKind`: a clash between two of the config's own
 * entities is `defineConfig`'s to report, and is left alone here.
 */
function assertOneKindPerSlug(claims: readonly SlugClaim[]): void {
  const first = new Map<string, SlugClaim>();
  for (const claim of claims) {
    const earlier = first.get(claim.slug);
    if (earlier === undefined) {
      first.set(claim.slug, claim);
      continue;
    }
    // One kind twice is `mergeKind`'s to report; code twice is `defineConfig`'s.
    if (earlier.kind === claim.kind) continue;
    if (earlier.owner === APP && claim.owner === APP) continue;
    throw slugCollisionError(claim.kind, claim.slug, [
      `${ownerLabel(earlier.owner)} (${earlier.kind})`,
      `${ownerLabel(claim.owner)} (${claim.kind})`,
    ]);
  }
}

/**
 * The entities a REGISTRY already holds, per kind, as this check reads them:
 * the Builder's own and the code-first rows registered beside them.
 */
export interface RegisteredEntitiesByKind {
  collections?: readonly Slugged[];
  singles?: readonly Slugged[];
  components?: readonly Slugged[];
}

/**
 * The same one-slug-one-kind rule, once the REGISTERED entities are known.
 *
 * 🔴 {@link assertOneKindPerSlug} runs at fold time, where the Builder's
 * entities cannot be seen: they live in the `dynamic_*` tables rather than in
 * any config, and the Builder's own merge pairs each kind separately. So a
 * Builder single and a plugin collection under one slug passed every check
 * and met only `assertGlobalResourceSlugAvailable`, at registration, where
 * one of the two is refused -- the app then boots missing whichever lost, and
 * the refusal names neither the other kind nor its owner.
 *
 * Run wherever the registered set becomes knowable -- the runtime after
 * `loadBuilderEntities`, the CLI after reading the ui-schema manifest -- it
 * refuses the pair up front, with both owners and kinds in the error.
 *
 * A registered row of the SAME kind as a configured entity is that entity's
 * own row, or a Builder entity the Builder's merge already resolves; neither
 * is this rule's business.
 */
export function assertRegisteredKeepTheirKind(
  config: Pick<NextlyServiceConfig, "collections" | "singles" | "fieldGroups">,
  registered: RegisteredEntitiesByKind
): void {
  assertOneKindPerSlug([
    ...appClaims(config),
    ...claimsOfKind("collection", "registered", registered.collections),
    ...claimsOfKind("single", "registered", registered.singles),
    ...claimsOfKind("component", "registered", registered.components),
  ]);
}

/**
 * Apply each plugin's `renameMap`, then fold the resolved
 * collections/singles/components into the config arrays (config-first, then
 * topo order). Pure. Throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a plugin-involved
 * collision, within a kind or across kinds. Shared by the throwing and
 * deferring folds below so both agree on the merged entity set before `extend`
 * is applied.
 */
function mergeRenamed(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): Pick<NextlyServiceConfig, "collections" | "singles" | "fieldGroups"> & {
  /** Slug → the plugin that contributed the entity; the app's are absent. */
  owners: Map<string, string>;
} {
  const renamed = plugins.map(p => ({
    owner: p.name,
    contributes: renamePluginContributes(p),
  }));
  const contributed = pluginClaims(renamed);
  // The config's own entities first, then each plugin's in resolved order:
  // the order a collision reads naturally, and the one `mergeKind` reports
  // one kind in.
  assertOneKindPerSlug([...appClaims(config), ...contributed]);
  return {
    // From the plugins' claims alone, so an app entity is never given an
    // owner whatever a plugin is named. A plugin's slug is unique across
    // kinds once the claims pass, so the slug alone names its owner.
    owners: new Map(contributed.map(claim => [claim.slug, claim.owner])),
    collections: mergeKind(
      "collection",
      config.collections ?? [],
      renamed.map(r => ({
        owner: r.owner,
        entities: r.contributes.collections,
      }))
    ),
    singles: mergeKind(
      "single",
      config.singles ?? [],
      renamed.map(r => ({ owner: r.owner, entities: r.contributes.singles }))
    ),
    fieldGroups: mergeKind(
      "component",
      config.fieldGroups ?? [],
      renamed.map(r => ({
        owner: r.owner,
        entities: r.contributes.fieldGroups,
      }))
    ),
  };
}

/**
 * @experimental Merge plugin `contributes` schema into the config. Pure — does
 * not mutate `config` or `plugins`. Applies each plugin's `renameMap`
 * before merging, then throws `NEXTLY_SCHEMA_SLUG_COLLISION` on a plugin-
 * involved slug collision and `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for an
 * `extend` against an unknown target.
 *
 * This eager form throws on ANY extend target absent from the code+plugin set.
 * Builder-aware callers use {@link applyPluginSchemaContributionsDeferred}
 * + {@link resolveBuilderExtends} instead, so a Builder target isn't mistaken
 * for a typo before Builder slugs are known.
 */
export function applyPluginSchemaContributions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): NextlyServiceConfig {
  // The fold is the one point every runtime and CLI path reaches, including
  // after a plugin setup transformer has returned a new config object.
  assertNoLegacyFieldGroupKey(config, "pluginFold");
  const { collections, singles, fieldGroups, owners } = mergeRenamed(
    config,
    plugins
  );

  // Second pass: apply `extend` over the fully-merged entity set (a plugin may
  // extend a code, own, or earlier-plugin entity). `extend[].target` is matched
  // against the merged (post-rename) slugs and is NOT itself rewritten through a
  // rename map — a plugin extending its own renamed entity must target the
  // renamed slug. (No current plugin extends its own entity.)
  const extended = applyExtends(
    collections,
    singles,
    fieldGroups,
    plugins,
    owners
  );

  const { leftAlone, ...entities } = extended;
  return {
    ...config,
    ...applyTransforms(entities, plugins, owners, leftAlone).entities,
  };
}

/**
 * @experimental Builder-aware fold: same merge + `extend` as
 * {@link applyPluginSchemaContributions}, but an `extend` target that isn't a
 * code/plugin entity is NOT thrown — it's returned in `deferredExtends`. The
 * caller resolves those against the Builder set (`resolveBuilderExtends`) once
 * Builder slugs are known: the CLI after `loadUiSchema`, the runtime after
 * `loadDynamicTables`. This is how extending a Builder-made collection works
 * without prematurely failing as an unknown target.
 */
export function applyPluginSchemaContributionsDeferred(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): FoldResult {
  // The fold is the one point every runtime and CLI path reaches, including
  // after a plugin setup transformer has returned a new config object.
  assertNoLegacyFieldGroupKey(config, "pluginFold");
  const { collections, singles, fieldGroups, owners } = mergeRenamed(
    config,
    plugins
  );
  const r = applyExtendClauses(
    collections,
    singles,
    fieldGroups,
    flattenExtends(plugins),
    "collect",
    { ...configuredScope(owners), defer: true }
  );
  const transformed = applyTransforms(
    {
      collections: r.collections,
      singles: r.singles,
      fieldGroups: r.fieldGroups,
    },
    plugins,
    owners,
    r.leftAlone
  );
  return {
    config: { ...config, ...transformed.entities },
    // A scope is deferred whole, beside the slugs no configured entity had:
    // the Builder's types it reaches are known only once they are read.
    deferredExtends: [...r.deferred, ...r.scopes],
    fieldsAddedByPlugins: transformed.fieldsAdded,
    leftAlone: r.leftAlone,
  };
}

/**
 * @experimental Apply deferred `extend` clauses (from
 * {@link applyPluginSchemaContributionsDeferred}) to the Builder/UI-schema
 * entities, matched by slug across collections/singles/components.
 * Pure: clones touched arrays. Throws `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for
 * any target that is in NEITHER code/plugin NOR the Builder set — a real typo.
 * On the CLI the returned (extended) entities drive the migration so the columns
 * materialize; the runtime uses it only to validate (the DB row is authoritative).
 */
export function resolveBuilderExtends(
  deferred: DeferredExtend[],
  builder: BuilderEntities
): BuilderEntities & { leftAlone: LeftAloneExtend[] } {
  // Tag merged fields with plugin provenance so the materialized Builder rows
  // (migrate output) carry source/owner/locked — the same tags the runtime
  // reconciler applies, so dev-push and migrate converge.
  const tagged = deferred.map(d => ({
    ...d,
    fields: tagPluginFields(d.fields, d.owner),
  }));
  const r = applyExtendClauses(
    builder.collections,
    builder.singles,
    builder.components,
    tagged,
    "throw"
  );
  return {
    collections: r.collections,
    singles: r.singles,
    components: r.fieldGroups,
    leftAlone: r.leftAlone,
  };
}

/**
 * @experimental Validate deferred extend targets at runtime: each must be a
 * known slug (a Builder/UI entity loaded from the DB, where the extend columns
 * were already materialized by `migrate`). Existence-only — it does NOT re-append
 * fields (the DB row is authoritative, so re-applying would duplicate columns,
 * unlike the CLI's `resolveBuilderExtends` which materializes). Throws
 * `NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN` for a target absent from `knownSlugs`.
 */
export function finalizeDeferredExtendTargets(
  deferred: DeferredExtend[],
  knownSlugs: Iterable<string>
): void {
  const known = new Set(knownSlugs);
  for (const d of deferred) {
    // A scope reaches whatever types exist, none included, so it is never
    // an unknown target.
    if (typeof d.target !== "string") continue;
    if (!known.has(d.target)) throw extendTargetUnknownError(d.target, d.owner);
  }
}
