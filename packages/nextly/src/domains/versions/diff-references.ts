/**
 * The version diff engine emits relationship and upload references as bare ids:
 * a `set` of targets for a many-relationship, or a `value` node's before/after
 * for a single one. This walks that computed tree and resolves every referenced
 * id to a display label through the access-checked resolver.
 *
 * A value node's before/after is rewritten in place to the value kit's display
 * shape (`{ id, label }` / `{ id, filename, ... }`), so the client renders it
 * through the same kit as a live value. A set node's targets each gain a
 * `label` beside the id, because those render as their own badges rather than
 * through that kit. Either way the id is kept inside the resolved value.
 *
 * It lives one layer above the pure engine (`diff/compute-diff.ts`) so that
 * engine stays dialect- and service-free: resolution needs access checks and
 * the collections/media services, which the engine must not reach.
 *
 * @module domains/versions/diff-references
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { UserContext } from "../singles/types";

import type { FieldDiff } from "./diff/types";
import {
  referenceDisplayValue,
  referenceLabelKey,
  resolveReferenceLabels,
  storedRefsOf,
  toReferenceRequest,
  type ReferenceKind,
  type ReferenceRequest,
  type ResolvedReference,
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
 * One side of a value node resolved to the value kit's display shape, or the
 * value returned unchanged when it carries no reference (an empty side, or one
 * past the resolve cap whose id must be kept).
 */
function resolveValueSide(
  value: unknown,
  kind: ReferenceKind,
  displayCollections: string[],
  labelField: string | undefined,
  labels: Map<string, ResolvedReference>
): unknown {
  const stored = storedRefsOf(value);
  if (stored.length === 0) return value;

  const resolveOne = (ref: (typeof stored)[number]): unknown => {
    const request = toReferenceRequest(
      kind,
      ref,
      displayCollections,
      labelField
    );
    const resolved = request
      ? labels.get(referenceLabelKey(request))
      : undefined;
    return referenceDisplayValue(ref, resolved);
  };

  // A `hasMany` upload side is an array; resolve every item, not just the first.
  return Array.isArray(value) ? stored.map(resolveOne) : resolveOne(stored[0]);
}

/** Push every reference in the tree onto `out`, descending groups and lists. */
function collect(fields: FieldDiff[], out: ReferenceRequest[]): void {
  for (const node of fields) {
    switch (node.kind) {
      case "value": {
        const kind = refKindOf(node.type);
        if (!kind) break;
        // An upload names its target through the same `display.relationTo` a
        // relationship uses; a plain upload names none and `toReferenceRequest`
        // defaults it to the built-in `media` library.
        const cols = displayTargets(node.display);
        const labelField = node.display?.labelField;
        for (const side of [node.before, node.after]) {
          for (const stored of storedRefsOf(side)) {
            const request = toReferenceRequest(kind, stored, cols, labelField);
            if (request) out.push(request);
          }
        }
        break;
      }
      case "set": {
        const cols = displayTargets(node.display);
        const labelField = node.display?.labelField;
        for (const target of [...node.added, ...node.removed]) {
          const request = toReferenceRequest(
            "relationship",
            { id: target.id, relationTo: target.relationTo },
            cols,
            labelField
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
      // Stated rather than left to fall through, so a node kind added later
      // has to be considered here instead of being skipped in silence.
      //
      // `richText` does carry media, and not in a form this walker can resolve.
      // A decorator's identity lives in its own properties — `src`, `images`,
      // `buttons` — which the projection records under the path taken to reach
      // them and reports as `attrChanges` on the block holding it. Those are
      // values inside a document rather than a field whose type declares what
      // it points at, so there is no id here to exchange for a filename: a
      // changed image reads as its `src` changing, where it changed.
      //
      // `source`, `text` and `unknown` carry no reference at all.
      case "richText":
      case "source":
      case "text":
      case "unknown":
        break;
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
        const cols = displayTargets(node.display);
        const labelField = node.display?.labelField;
        node.before = resolveValueSide(
          node.before,
          kind,
          cols,
          labelField,
          labels
        );
        node.after = resolveValueSide(
          node.after,
          kind,
          cols,
          labelField,
          labels
        );
        break;
      }
      case "set": {
        const cols = displayTargets(node.display);
        const labelField = node.display?.labelField;
        for (const target of [...node.added, ...node.removed]) {
          const request = toReferenceRequest(
            "relationship",
            { id: target.id, relationTo: target.relationTo },
            cols,
            labelField
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
      // Named for the same reason as in `collect`: these kinds hold nothing
      // this walker can resolve, and saying so keeps a later kind from
      // inheriting the skip by omission.
      case "richText":
      case "source":
      case "text":
      case "unknown":
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
  user: UserContext,
  authenticatedScope?: AuthenticatedScope,
  locale?: string | null
): Promise<void> {
  const requests: ReferenceRequest[] = [];
  collect(fields, requests);
  if (requests.length === 0) return;

  const labels = await resolveReferenceLabels(
    requests,
    user,
    authenticatedScope,
    locale
  );
  annotate(fields, labels);
}
