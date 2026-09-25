/**
 * Letting a plugin MODIFY another plugin's entities, not only add to them.
 *
 * A plugin can already add fields to any entity through `contributes.extend`.
 * What it cannot do is change one — because `setup(config)` runs before plugin
 * schema contributions are merged, so it never sees another plugin's
 * collections at all. Payload plugins receive the whole config, earlier
 * plugins' collections included, and can change anything in it.
 *
 * Transforms run AFTER everything is merged, which is the only point at which
 * "another plugin's collection" exists to be changed.
 *
 * ## Why each transform gets a frozen copy
 *
 * A transform returns a new definition rather than mutating the one it was
 * given. Mutation would make the result depend on whether a later transform
 * happened to read a field before or after an earlier one wrote it — and that
 * ordering is invisible in the config, so the bug would present as a plugin
 * that works until another is installed.
 *
 * @module plugins/entity-transforms
 * @since 1.0.0
 */
import { NextlyError } from "../errors/nextly-error";

export type EntityKind = "collection" | "single" | "component";

export interface EntityTransform {
  /** Entity slug(s): the app's, the Builder's, or any plugin's. */
  target: string | string[];
  kind?: EntityKind;
  transform: (
    entity: Readonly<Record<string, unknown>>
  ) => Record<string, unknown>;
}

export interface TransformContribution {
  /** `plugin:<name>` or `app`, for attribution when one throws. */
  source: string;
  transforms: readonly EntityTransform[];
}

export interface TransformableEntity {
  slug: string;
  kind: EntityKind;
  definition: Record<string, unknown>;
}

function targets(transform: EntityTransform): string[] {
  return Array.isArray(transform.target)
    ? transform.target
    : [transform.target];
}

/**
 * Run every transform, in the order given, over the merged entities.
 *
 * `contributions` must already be in topological plugin order with the app
 * last — the same order schema hooks run in, and for the same reason: a plugin
 * transforming a dependency's collection must see it as the dependency left
 * it, and the app must see everything.
 */
export function runEntityTransforms(
  entities: readonly TransformableEntity[],
  contributions: readonly TransformContribution[]
): TransformableEntity[] {
  const bySlug = new Map(
    entities.map(entity => [
      `${entity.kind}\u0000${entity.slug}`,
      { ...entity },
    ])
  );

  for (const contribution of contributions) {
    for (const [position, transform] of contribution.transforms.entries()) {
      for (const slug of targets(transform)) {
        applyOne(bySlug, contribution, transform, slug, position);
      }
    }
  }

  return [...bySlug.values()];
}

/** The entities one transform targets, or a refusal naming the missing slug. */
function matchesFor(
  bySlug: ReadonlyMap<string, TransformableEntity>,
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): [string, TransformableEntity][] {
  const matches = [...bySlug.entries()].filter(
    ([, entity]) =>
      entity.slug === slug &&
      (transform.kind === undefined || entity.kind === transform.kind)
  );
  if (matches.length > 0) return matches;

  // Refused rather than ignored. A transform naming an entity that is not
  // there is a typo or a missing dependency, and doing nothing silently means
  // the plugin appears installed and simply has no effect — the hardest kind
  // of "working" to diagnose.
  throw NextlyError.validation({
    errors: [
      {
        path: `${contribution.source}.transform[${String(position)}]`,
        code: "INVALID",
        message: `Transform targets "${slug}", which no ${transform.kind ?? "entity"} declares.`,
      },
    ],
  });
}

/** Run one transform over one entity, with attribution on failure. */
/**
 * A deeply frozen COPY of a value.
 *
 * A copy rather than freezing in place: the input is the live config, and
 * freezing that would turn every later legitimate write into a silent no-op
 * (or a throw in strict mode) far from here. Arrays and plain objects are
 * rebuilt; anything else — a Date, a RegExp, a function a field uses as a
 * validator — is passed through as it is, because copying it would change
 * what the transform receives.
 */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => deepFreeze(item))) as unknown as T;
  }
  if (value === null || typeof value !== "object") return value;
  // Plain objects only. A class instance rebuilt as a bare object would lose
  // its prototype, and with it any method the transform means to call.
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return value;

  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = deepFreeze(item);
  }
  return Object.freeze(copy) as unknown as T;
}

function transformOne(
  entity: { definition: Record<string, unknown> },
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): Record<string, unknown> {
  const path = `${contribution.source}.transform[${String(position)}]`;
  let next: unknown;
  try {
    // Frozen ALL THE WAY DOWN, so a transform that mutates instead of
    // returning fails loudly here rather than making the result depend on
    // transform order.
    //
    // `Object.freeze({ ...definition })` froze only the outer object. The
    // spread copies references, so `entity.fields.push(...)` and
    // `entity.fields[0].name = "x"` reached the arrays and field objects of
    // the ORIGINAL config, changed it in place, and then returned normally —
    // the guard this comment promises, silently absent exactly where it
    // matters most.
    next = transform.transform(deepFreeze(entity.definition));
  } catch (cause) {
    if (cause instanceof NextlyError) throw cause;
    throw NextlyError.internal({
      cause: cause instanceof Error ? cause : undefined,
      logContext: {
        reason: "entity transform failed",
        source: contribution.source,
        target: slug,
        transformIndex: position,
      },
    });
  }

  if (typeof next !== "object" || next === null) {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "INVALID",
          message: `Transform of "${slug}" returned ${next === null ? "null" : typeof next}. It must return the new entity definition.`,
        },
      ],
    });
  }
  // A transform reshapes an entity; it does not become a different one.
  //
  // Returning a different `slug` left the map key and the outer `entity.slug`
  // as they were while the returned definition carried the new one. Two things
  // followed, both silent: transforms run AFTER slug-collision validation, so
  // renaming `posts` to `users` produced two configured entities claiming
  // `users` and nothing re-checked it; and every later transform still matched
  // on `posts`, so none could target what the entity now called itself.
  //
  // Refused rather than re-keyed. Re-keying would have to re-run collision
  // validation and re-resolve the targets of transforms already applied, and
  // a rename is not what this hook is for — `remapEntities` is.
  const returned = next as Record<string, unknown>;
  const declared = entity.definition.slug;
  if (
    typeof returned.slug === "string" &&
    typeof declared === "string" &&
    returned.slug !== declared
  ) {
    throw NextlyError.validation({
      errors: [
        {
          path,
          code: "INVALID",
          message: `Transform of "${slug}" returned a definition with slug "${returned.slug}". A transform may reshape an entity but not rename it — slug collisions are validated before transforms run, and later transforms still target the declared slug. Use remapEntities to rename.`,
        },
      ],
    });
  }
  return returned;
}

function applyOne(
  bySlug: Map<string, TransformableEntity>,
  contribution: TransformContribution,
  transform: EntityTransform,
  slug: string,
  position: number
): void {
  for (const [key, entity] of matchesFor(
    bySlug,
    contribution,
    transform,
    slug,
    position
  )) {
    bySlug.set(key, {
      ...entity,
      definition: transformOne(entity, contribution, transform, slug, position),
    });
  }
}
