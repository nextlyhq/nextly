/**
 * Block migrations. When a stored node was written against an older schema
 * version of its block than the definition now declares, its props are upgraded
 * through a chain of per-version functions ({@link MigrationMap}) — one step per
 * version — until it reaches the current version.
 *
 * Runtime-free like the rest of the engine. The upgrade functions are supplied
 * by the caller (they live on block definitions); this module owns only the
 * chaining, the failure handling, and the gap detection.
 *
 * Policy is split by caller, not by mode here: `migrateDocument` always upgrades
 * what it can and returns the failures it hit. A publish path treats any failure
 * as blocking (strict); a render path renders the returned document, showing a
 * placeholder for each node flagged `migrationFailed` (forgiving).
 */
import type { BlockDocument, BlockNode } from "./document";
import { isPlainRecord } from "./plain-record";

/** Upgrade a node's props from one schema version to the next. Must be pure. */
export type MigrateFn = (
  props: Record<string, unknown>
) => Record<string, unknown>;

/**
 * Per-version upgrade functions, keyed by the FROM version. `map[n]` upgrades a
 * node stored at version `n` to version `n + 1`; chaining them walks a node from
 * its stored version up to the definition's current version.
 */
export type MigrationMap = Record<number, MigrateFn>;

/** What migration needs to know about one block type. */
export interface BlockMigrationInfo {
  /** The block definition's current schema version. */
  version: number;
  /** Upgrade steps keyed by from-version; omitted when the block never changed. */
  migrate?: MigrationMap;
}

/**
 * A lookup from block type to its migration info. A concrete registry satisfies
 * this; keeping it an interface avoids coupling migration to that registry. A
 * type the source does not know is treated as unknown and left untouched.
 */
export interface MigrationSource {
  get(type: string): BlockMigrationInfo | undefined;
}

/** One node that could not be brought to its block's current version. */
export interface MigrationFailure {
  /** JSON-Pointer to the node in the document. */
  path: string;
  type: string;
  fromVersion: number;
  toVersion: number;
  message: string;
}

/**
 * One node whose OWN props migration replaced.
 *
 * Reported so a reader can ask what the rewrite changed about a node without
 * re-deriving which nodes were rewritten. The alternative — comparing node
 * references across the two documents — answers the same question a second
 * time, and rests on an invariant that holds today and is asserted only for
 * top-level nodes.
 *
 * Scoped to a node's OWN props, deliberately. `migrateNode` also rebuilds a
 * parent whose child changed, so reference inequality is wider than this: such
 * a parent carries the props it always had, and anything derived from its props
 * answers exactly as before. Reporting it would send readers to re-examine
 * nodes nothing can have changed about.
 */
export interface MigratedNode {
  /** JSON-Pointer to the node, in BOTH the pre- and post-migration document. */
  path: string;
  /** The node's `id`, when it carries a usable one. */
  id?: string;
  type: string;
  fromVersion: number;
  /** The version reached. Below `toVersion` of the definition when a step failed. */
  toVersion: number;
}

export interface MigrateResult {
  doc: BlockDocument;
  failures: MigrationFailure[];
  /**
   * Every node whose props were rewritten, in document order.
   *
   * COMPLETENESS is the load-bearing property, not brevity. A reader uses this
   * to decide which nodes still need examining, so a node missing from it is
   * silently exempted from whatever the reader was checking — no error and no
   * slow path, just a check that did not run. `migration.test.ts` guards the
   * producer for that reason rather than guarding any one consumer.
   */
  rewritten: MigratedNode[];
}

/** Result of upgrading a single props object. */
export interface PropsMigrationResult {
  props: Record<string, unknown>;
  /** Set when a step was missing or threw; `props` is the last good value. */
  failure?: { fromVersion: number; message: string };
}

/**
 * The largest version span migration will chain across. Block versions
 * increment by one per schema change, so a span this large signals a malformed
 * version rather than a real upgrade; it also bounds the loops below.
 */
export const MAX_MIGRATION_STEPS = 1000;

/** True if a version range is a sane, finite, bounded span of non-negative integers. */
function isValidVersionRange(fromVersion: number, toVersion: number): boolean {
  return (
    Number.isInteger(fromVersion) &&
    fromVersion >= 0 &&
    Number.isInteger(toVersion) &&
    toVersion >= 0 &&
    toVersion - fromVersion <= MAX_MIGRATION_STEPS
  );
}

/**
 * The version steps missing from `map` to carry a node from `fromVersion` up to
 * `toVersion`. An empty array means the chain is complete. Used to reject a
 * block whose version was bumped without a covering migration. An out-of-range
 * or non-integer span returns an empty array; version sanity is a separate
 * check on the definition.
 */
export function findMigrationGaps(
  fromVersion: number,
  toVersion: number,
  map: MigrationMap | undefined
): number[] {
  if (fromVersion >= toVersion) return [];
  if (!isValidVersionRange(fromVersion, toVersion)) return [];
  const gaps: number[] = [];
  for (let v = fromVersion; v < toVersion; v++) {
    if (!map || typeof map[v] !== "function") gaps.push(v);
  }
  return gaps;
}

/**
 * Upgrade a props object from `fromVersion` to `toVersion` by applying each
 * step in order. Reusable beyond documents: locale-overlay values run through
 * the same chain. Never throws — a missing step or a throwing step stops the
 * chain and returns the last good props with a `failure`.
 */
export function migrateProps(
  props: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  map: MigrationMap | undefined
): PropsMigrationResult {
  if (fromVersion >= toVersion) return { props };
  // Reject non-integer, negative, or absurdly wide spans before iterating: an
  // Infinity target would loop forever, a -Infinity start would never advance.
  if (!isValidVersionRange(fromVersion, toVersion)) {
    return {
      props,
      failure: {
        fromVersion,
        message: `Invalid migration version range ${fromVersion}→${toVersion}.`,
      },
    };
  }
  let current = props;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = map?.[v];
    if (typeof step !== "function") {
      return {
        props: current,
        failure: { fromVersion: v, message: `No migration from version ${v}.` },
      };
    }
    try {
      // Widen to unknown: a step's declared return type does not bind a
      // plain-JS caller, so its result is validated at runtime.
      const next: unknown = step(current);
      // A step must return a props object; anything else is a failed upgrade.
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        return {
          props: current,
          failure: {
            fromVersion: v,
            message: `Migration from version ${v} did not return a props object.`,
          },
        };
      }
      current = next as Record<string, unknown>;
    } catch (error) {
      return {
        props: current,
        failure: {
          fromVersion: v,
          message:
            error instanceof Error
              ? error.message
              : `Migration from version ${v} threw.`,
        },
      };
    }
  }
  return { props: current };
}

function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointer(parent: string, token: string | number): string {
  return `${parent}/${escapePointer(String(token))}`;
}

/**
 * Upgrade every node in a document to its block's current schema version.
 *
 * - A type the source does not know (an unregistered/plugin block) is preserved
 *   untouched, including its version — nothing is lost.
 * - A node already at (or ahead of) the current version is left as is.
 * - A node behind the current version is chained forward. On success its props
 *   and version are updated; on failure it keeps its last-good props and is
 *   flagged `migrationFailed`, and the failure is collected for the caller.
 *
 * Immutable: returns a new document; the input is never modified. It recurses
 * over the node tree, whose depth is bounded by the document limits validation
 * enforces, so migration is meant to run on structurally-valid documents (pair
 * it with `validate` for untrusted input).
 */
export function migrateDocument(
  doc: BlockDocument,
  source: MigrationSource
): MigrateResult {
  const failures: MigrationFailure[] = [];
  const rewritten: MigratedNode[] = [];

  // Called from every branch that replaces a node's props, rather than derived
  // afterwards from what changed. A second pass comparing documents would be a
  // separate implementation of "was this rewritten", free to disagree with the
  // rewrite that actually happened.
  const recordRewrite = (
    node: BlockNode,
    path: string,
    fromVersion: number,
    toVersion: number,
    props: Record<string, unknown>
  ): void => {
    // The props OBJECT is what decides it, not the version stamp. A step that
    // returns its input unchanged, and a failure at the very first step, both
    // leave the stored object in place — so anything a reader derived from
    // those props still holds, and naming the node would send it to re-examine
    // something nothing can have changed about.
    if (props === node.props) return;
    rewritten.push({
      path,
      // Omitted rather than coerced when absent or of the wrong type: a reader
      // matching on it must not be handed an id the document does not carry.
      ...(typeof node.id === "string" && node.id !== "" ? { id: node.id } : {}),
      type: node.type,
      fromVersion,
      toVersion,
    });
  };

  const migrateNode = (node: BlockNode, path: string): BlockNode => {
    if (!isPlainRecord(node)) return node;

    let next = node;
    const info = source.get(node.type);
    if (
      info !== undefined &&
      Number.isInteger(node.version) &&
      node.version >= 0 &&
      Number.isInteger(info.version) &&
      node.version < info.version
    ) {
      const result = migrateProps(
        node.props,
        node.version,
        info.version,
        info.migrate
      );
      if (result.failure) {
        failures.push({
          path,
          type: node.type,
          fromVersion: result.failure.fromVersion,
          toVersion: info.version,
          message: result.failure.message,
        });
        // Stamp the version at the last-good level (the from-version of the
        // step that failed): the props are already in that version's shape, so
        // the version must match or a retry would re-run completed, possibly
        // non-idempotent steps. Flag the node so a renderer can placeholder it.
        next = {
          ...node,
          props: result.props,
          version: result.failure.fromVersion,
          migrationFailed: true,
        };
        // Reported when steps ran before the failing one, because the props are
        // then no longer the stored ones and a reader's conclusions about them
        // are stale. A failure at the FIRST step ran nothing, so the props are
        // the stored object and nothing derived from them can have moved.
        recordRewrite(
          node,
          path,
          node.version,
          result.failure.fromVersion,
          result.props
        );
      } else {
        next = { ...node, props: result.props, version: info.version };
        if (next.migrationFailed) delete next.migrationFailed;
        recordRewrite(node, path, node.version, info.version, result.props);
      }
    }

    if (!isPlainRecord(next.slots)) return next;
    let slotsChanged = false;
    const slots: Record<string, BlockNode[]> = {};
    for (const [slot, children] of Object.entries(next.slots)) {
      if (!Array.isArray(children)) {
        slots[slot] = children;
        continue;
      }
      const slotPath = pointer(pointer(path, "slots"), slot);
      const migratedChildren = children.map((child, index) =>
        migrateNode(child, pointer(slotPath, index))
      );
      slots[slot] = migratedChildren;
      if (migratedChildren.some((c, i) => c !== children[i]))
        slotsChanged = true;
    }
    return slotsChanged || next !== node ? { ...next, slots } : next;
  };

  const nodes = Array.isArray(doc.nodes)
    ? doc.nodes.map((node, index) =>
        migrateNode(node, pointer("/nodes", index))
      )
    : doc.nodes;

  return { doc: { ...doc, nodes }, failures, rewritten };
}
