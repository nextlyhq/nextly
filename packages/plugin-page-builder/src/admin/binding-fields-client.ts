/**
 * The editor's side of the binding routes: the picker's fields, kept briefly
 * per person and page, and an unbind's plan, asked against the document the
 * editor holds.
 *
 * The picker opens often, on any bindable prop, and what it lists changes
 * only when the schema or an entry does, so one answer serves for a short
 * while; it is kept per person, so a read in flight when one person signs out
 * is never handed to the next, and per page and language, as it is read.
 *
 * @module admin/binding-fields-client
 */
import type {
  BindingFieldSource,
  UnbindAsk,
  UnbindPlanAnswer,
} from "@nextlyhq/builder/ops";
import {
  writePluginRoute,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";

import {
  BINDING_FIELDS_ROUTE_PATH,
  type BindingFieldsRequest,
  type BindingFieldsResponse,
} from "../binding-fields-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  UNBIND_PLAN_ROUTE_PATH,
  type UnbindPlanRequest,
} from "../unbind-plan-contract";

/** How long one answer of the picker's fields is kept, in milliseconds. */
export const BINDING_FIELDS_KEPT_MS = 30_000;

/** One kept answer: when it was asked, and the read. */
interface Kept {
  readonly at: number;
  readonly read: Promise<readonly BindingFieldSource[]>;
}

/** The answers kept, and whose they are. */
const kept = new Map<string, Kept>();
let keptFor: string | null | undefined;

/** One ask of the fields route. */
async function askFields(
  request: BindingFieldsRequest
): Promise<readonly BindingFieldSource[]> {
  const body = await writePluginRoute<BindingFieldsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: BINDING_FIELDS_ROUTE_PATH,
    method: "POST",
    body: request,
  });
  if (body === undefined || !Array.isArray(body.sources)) {
    throw new Error("The fields a binding can read could not be read.");
  }
  return body.sources;
}

/**
 * The picker's read of the fields for the entry `identity` names (none for
 * a document with no entry of its own, such as a component's), in
 * `locale`, as `userId` reads them: an answer kept for
 * {@link BINDING_FIELDS_KEPT_MS}, or asked afresh. A failed read is not
 * kept, so the next opening asks again.
 */
export function bindingFieldsReader(
  identity: DocumentIdentity | null,
  locale: string | undefined,
  userId: string | null,
  ask: (
    request: BindingFieldsRequest
  ) => Promise<readonly BindingFieldSource[]> = askFields,
  now: () => number = Date.now
): () => Promise<readonly BindingFieldSource[]> {
  return () => {
    // Another person's answers are dropped before anything is read.
    if (keptFor !== userId) {
      kept.clear();
      keptFor = userId;
    }
    // No entry, as for a component's document: the Singles and the site.
    const request: BindingFieldsRequest = {
      ...(identity === null
        ? {}
        : {
            source: {
              kind: identity.kind,
              slug: identity.slug,
              ...(identity.documentId === undefined
                ? {}
                : { id: identity.documentId }),
            },
          }),
      ...(locale === undefined ? {} : { locale }),
    };
    // While the person signed in is not known yet, nothing is kept: an
    // answer kept under no one could be handed to whoever signs in next.
    if (userId === null) return ask(request);
    const key = JSON.stringify(request);
    const hit = kept.get(key);
    if (hit !== undefined && now() - hit.at < BINDING_FIELDS_KEPT_MS) {
      return hit.read;
    }
    const at = now();
    // Aged answers are dropped as a new one is kept, so a long session that
    // opens many pages holds only the last half-minute's.
    for (const [old, { at: when }] of kept) {
      if (at - when >= BINDING_FIELDS_KEPT_MS) kept.delete(old);
    }
    const entry: Kept = { at, read: ask(request) };
    kept.set(key, entry);
    entry.read.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    return entry.read;
  };
}

/**
 * The inspector's unbind planner for the page `identity` names, in `locale`:
 * a saved collection entry or a Single; absent for an entry not saved yet,
 * which the plan route can't read.
 */
export function unbindPlanner(
  identity: DocumentIdentity | null,
  locale: string | undefined
): ((ask: UnbindAsk) => Promise<UnbindPlanAnswer>) | undefined {
  if (identity === null) return undefined;
  const at = locale === undefined ? {} : { locale };
  let page: UnbindPlanRequest["page"];
  if (identity.kind === "single") {
    page = { single: identity.slug, ...at };
  } else if (identity.documentId === undefined) {
    return undefined;
  } else {
    page = { collection: identity.slug, id: identity.documentId, ...at };
  }
  return async ask => {
    const request: UnbindPlanRequest = {
      page,
      document: ask.document,
      action: {
        kind: "unbind-prop",
        nodeId: ask.nodeId,
        prop: ask.prop,
        ...(ask.keep === undefined ? {} : { keep: ask.keep }),
      },
    };
    const body = await writePluginRoute<UnbindPlanAnswer>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: UNBIND_PLAN_ROUTE_PATH,
      method: "POST",
      body: request,
    });
    if (body === undefined || !("refusal" in body || "kept" in body)) {
      throw new Error("The unbind could not be planned.");
    }
    return body;
  };
}
