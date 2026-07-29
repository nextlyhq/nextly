/**
 * The version diff engine emits relationship and upload references as bare ids:
 * a `set` of targets for a many-relationship, or a `value` node's before/after
 * for a single one. This walks that computed tree, resolves every referenced id
 * to a display label through the access-checked resolver, and attaches the
 * result ADDITIVELY: a `label` on each target, a `beforeRef`/`afterRef` on each
 * value node. The ids in the tree are never rewritten.
 *
 * It lives one layer above the pure engine (`diff/compute-diff.ts`) so that
 * engine stays dialect- and service-free: resolution needs access checks and
 * the collections/media services, which the engine must not reach.
 *
 * @module domains/versions/diff-references
 */

import type { UserContext } from "../singles/types";

import type { FieldDiff, ResolvedReference } from "./diff/types";
import {
  referenceLabelKey,
  resolveReferenceLabels,
  storedRefsOf,
  type ReferenceKind,
  type ReferenceRequest,
  type StoredRef,
} from "./reference-labels";

/** The reference kind a value node's field type resolves to, if any. */
function refKindOf(type: string): ReferenceKind | null {
  if (type === "relationship") return "relationship";
  if (type === "upload") return "upload";
  return null;
}

/** The target collection(s) a node's display declares, as a plain list. */
function displayTargets(
  display: { relationTo?: string | string[] } | undefined
): string[] {
  const rel = display?.relationTo;
  if (typeof rel === "string") return [rel];
  if (Array.isArray(rel))
    return rel.filter((r): r is string => typeof r === "string");
  return [];
}

/**
 * A resolvable request for one stored reference. The target collection is the
 * value's own when polymorphic, otherwise the field's first declared target;
 * uploads always resolve against media.
 */
function toRequest(
  kind: ReferenceKind,
  stored: StoredRef,
  displayCollections: string[]
): ReferenceRequest | null {
  const collection =
    kind === "upload" ? "media" : (stored.relationTo ?? displayCollections[0]);
  if (!collection || !stored.id) return null;
  return { kind, collection, id: stored.id };
}

/** The resolved reference for one side of a value node, or null if none. */
function resolvedFor(
  value: unknown,
  kind: ReferenceKind,
  displayCollections: string[],
  labels: Map<string, ResolvedReference>
): ResolvedReference | null {
  const [stored] = storedRefsOf(value);
  if (!stored) return null;
  const request = toRequest(kind, stored, displayCollections);
  if (!request) return null;
  return labels.get(referenceLabelKey(request)) ?? null;
}

/** Push every reference in the tree onto `out`, descending groups and lists. */
function collect(fields: FieldDiff[], out: ReferenceRequest[]): void {
  for (const node of fields) {
    switch (node.kind) {
      case "value": {
        const kind = refKindOf(node.type);
        if (!kind) break;
        const cols =
          kind === "upload" ? ["media"] : displayTargets(node.display);
        for (const side of [node.before, node.after]) {
          for (const stored of storedRefsOf(side)) {
            const request = toRequest(kind, stored, cols);
            if (request) out.push(request);
          }
        }
        break;
      }
      case "set": {
        const cols = displayTargets(node.display);
        for (const target of [...node.added, ...node.removed]) {
          const request = toRequest(
            "relationship",
            { id: target.id, relationTo: target.relationTo },
            cols
          );
          if (request) out.push(request);
        }
        break;
      }
      case "group":
        collect(node.fields, out);
        break;
      case "list":
        for (const item of node.items) collect(item.fields, out);
        break;
      // text and unknown nodes carry no resolvable reference.
    }
  }
}

/** Attach resolved labels to the tree in place, descending groups and lists. */
function annotate(
  fields: FieldDiff[],
  labels: Map<string, ResolvedReference>
): void {
  for (const node of fields) {
    switch (node.kind) {
      case "value": {
        const kind = refKindOf(node.type);
        if (!kind) break;
        const cols =
          kind === "upload" ? ["media"] : displayTargets(node.display);
        node.beforeRef = resolvedFor(node.before, kind, cols, labels);
        node.afterRef = resolvedFor(node.after, kind, cols, labels);
        break;
      }
      case "set": {
        const cols = displayTargets(node.display);
        for (const target of [...node.added, ...node.removed]) {
          const request = toRequest(
            "relationship",
            { id: target.id, relationTo: target.relationTo },
            cols
          );
          const resolved = request
            ? labels.get(referenceLabelKey(request))
            : undefined;
          if (resolved) target.label = resolved.label;
        }
        break;
      }
      case "group":
        annotate(node.fields, labels);
        break;
      case "list":
        for (const item of node.items) annotate(item.fields, labels);
        break;
    }
  }
}

/**
 * Resolve and attach display labels for every relationship and upload reference
 * in a computed diff tree, in place. A no-op when the tree carries no reference.
 */
export async function hydrateDiffReferences(
  fields: FieldDiff[],
  user: UserContext
): Promise<void> {
  const requests: ReferenceRequest[] = [];
  collect(fields, requests);
  if (requests.length === 0) return;

  const labels = await resolveReferenceLabels(requests, user);
  annotate(fields, labels);
}
