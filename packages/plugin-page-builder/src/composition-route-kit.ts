/**
 * What the composition routes share: who the caller is and whether they may
 * act, the options every write runs with, the reads made as the caller, the
 * store components live in, refusals in one envelope, and the usage indexes
 * brought up to date after a write in a caller-owned transaction.
 *
 * @module composition-route-kit
 */
import {
  sameStoredValue,
  type BlockDocument,
  type DocumentLimits,
  type PlanProblem,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  resolvedCollectionDraftSplit,
  resolvedCollectionView,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { slugify } from "nextly";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import type { CommittedWriteReconciler } from "./class-usage-hook";
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { COMPONENTS_SLUG } from "./collections/components";
import type { ActionBy } from "./component-actions-contract";
import { documentVersionOf } from "./document-version";
import { asServiceCaller, type ComponentStore } from "./library-route";
import {
  templateTargetOf,
  type TemplateTarget,
} from "./templates/template-target";

/** The capabilities the composition routes use, named rather than imported whole. */
export type CompositionRouteContext = Pick<
  PluginRouteContext,
  "self" | "user" | "caller" | "authenticatedScope"
> &
  Partial<Pick<PluginRouteContext, "params" | "logger">> & {
    services: {
      collections: Pick<
        PluginRouteContext["services"]["collections"],
        | "createEntry"
        | "updateEntry"
        | "withTransaction"
        | "createEntryInTransaction"
        | "updateEntryInTransaction"
        | "warmLocalizedReadiness"
      >;
    };
  };

/** What every composition route is built with. */
export interface CompositionRouteSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
  /** Reconcile the usage indexes after a write in a caller-owned transaction. */
  readonly reconcile?: () => CommittedWriteReconciler | undefined;
  /** The Direct API the reconciliation reads through; the booted one by default. */
  readonly directApi?: () => ClassUsageDirectApi;
}

/**
 * Whether the configured store is a collection of the host's own: one named,
 * and not this plugin's own components under the name the host resolved.
 */
export function isHostStore(
  ctx: {
    readonly self: { readonly collections: Record<string, string | undefined> };
  },
  store: Pick<ComponentStore, "collection"> | undefined
): boolean {
  const named = store?.collection;
  if (named === undefined) return false;
  return named !== (ctx.self.collections[COMPONENTS_SLUG] ?? COMPONENTS_SLUG);
}

/**
 * Refuse a host whose components live in a collection of its own: that store
 * promises only the document field, not the title, slug and publish workflow
 * a new component is created with here.
 */
export function requirePluginStore(
  ctx: Pick<CompositionRouteContext, "self">,
  setup: Pick<CompositionRouteSetup, "store">
): void {
  if (!isHostStore(ctx, setup.store)) return;
  throw new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage:
      "Components on this site are kept in a collection of its own, so they are made and copied there rather than from the editor.",
    logMessage: "Refused a composition request for a host store",
    logContext: { reason: "composition-host-store" },
  });
}

/** The field the plugin's own components collection stores a definition in. */
const DEFAULT_COMPONENT_FIELD = "content";

/** The store components live in: the configured one, or this plugin's. */
export function storeOf(
  ctx: Pick<CompositionRouteContext, "self">,
  setup: Pick<CompositionRouteSetup, "store">
): { collection: string; field: string } {
  return {
    collection:
      setup.store?.collection ??
      ctx.self.collections[COMPONENTS_SLUG] ??
      COMPONENTS_SLUG,
    field: setup.store?.field ?? DEFAULT_COMPONENT_FIELD,
  };
}

/**
 * The caller, once shown to hold every grant asked for beyond the route's
 * declared permission, as the answer reports them; otherwise the refusal. The
 * declared permission is judged before the handler runs and is not asked
 * again: a second answer could refuse a request the route admitted.
 */
export async function actingCaller(
  ctx: CompositionRouteContext,
  asks: readonly (readonly [action: string, resource: string])[] = [],
  /**
   * `{ anyEntry: true }` asks whether the caller may act on any entry at all,
   * for a route whose write, made as the caller, then decides the entry it
   * names: a rule limiting the action to some entries answers no to a
   * question that names none.
   */
  options?: { readonly anyEntry?: boolean }
): Promise<ActionBy> {
  const { user, caller } = ctx;
  let allowed = user !== null && caller !== null;
  for (const [action, resource] of asks) {
    if (!allowed) break;
    allowed = (await caller?.can(action, resource, options)) === true;
  }
  if (!allowed || user === null || caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "composition-action-not-granted", asks },
    });
  }
  return actionByOf(user, caller);
}

/**
 * Who a request runs as, as an answer reports it: the signed-in person, or the
 * API key and the person who owns it. Every route that says `by` derives it
 * here, so a key is never reported as its owner by one route and as the key by
 * another.
 */
export function actionByOf(
  user: { readonly id: string },
  caller: {
    readonly authMethod?: "session" | "api-key";
    readonly apiKeyId?: string;
  }
): ActionBy {
  return caller.authMethod === "api-key"
    ? {
        kind: "api-key",
        userId: user.id,
        ...(caller.apiKeyId === undefined ? {} : { apiKeyId: caller.apiKeyId }),
      }
    : { kind: "user", userId: user.id };
}

/** The options a write runs with: as the caller, and under a key's own scope. */
export interface CallerWriteOptions {
  readonly as: "user";
  readonly user: NonNullable<PluginRouteContext["user"]> | undefined;
  readonly authenticatedScope?: NonNullable<
    PluginRouteContext["authenticatedScope"]
  >;
  readonly locale?: string;
}

/**
 * The write options every write runs with: as the caller, key scope and all,
 * in the language named when the page's blocks field is translated.
 */
export function asCaller(
  ctx: CompositionRouteContext,
  /** The language written, when the blocks field is translated. */
  locale?: string
): CallerWriteOptions {
  return {
    ...(locale === undefined ? {} : { locale }),
    ...asServiceCaller(ctx),
  };
}

/** A read, or `null` when the row is missing or the caller may not read it. */
export async function readOrNull(
  read: () => Promise<unknown>
): Promise<unknown> {
  try {
    return await read();
  } catch (error) {
    if (NextlyError.isNotFound(error) || NextlyError.isForbidden(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * A row's blocks field, or `null` when it holds none: absent, empty, or a
 * value of another kind (a caller naming a text field, say), which is not a
 * document to plan against.
 */
export function blocksDocumentOf(
  row: unknown,
  field: string
): BlockDocument | null {
  const value = (row as Record<string, unknown> | null)?.[field];
  if (typeof value !== "object" || value === null) return null;
  return Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as BlockDocument)
    : null;
}

/**
 * Whether a write naming no status changes what the site serves: the
 * collection has a Draft/Published lifecycle but cannot hold a working draft,
 * so an edit of a published entry lands on it in place. Such a write is a
 * publish, and is asked for as one.
 */
export async function savesLive(
  collections: {
    getCollection(
      name: string,
      context: Record<string, never>
    ): Promise<unknown>;
  },
  collection: string
): Promise<boolean> {
  const view = resolvedCollectionView(
    await collections.getCollection(collection, {})
  );
  if (view.status !== true) return false;
  return !(await resolvedCollectionDraftSplit(view)).eligible;
}

/** A stored page's blocks document, and the version of the read it came from. */
export interface StoredPageRead {
  readonly document: BlockDocument;
  /** The row's version as read; absent from a server that issues none. */
  readonly rev: string | undefined;
  /**
   * The collection the row names, where it is a template's: carried on the
   * write of its blocks (`carryingTemplateTarget`), so the write is judged
   * against it. Absent for any row naming none.
   */
  readonly templateTarget?: TemplateTarget;
}

/** A row's blocks field with the row's version, or `null` when it holds none. */
export function storedPageReadOf(
  row: unknown,
  field: string
): StoredPageRead | null {
  const document = blocksDocumentOf(row, field);
  if (document === null) return null;
  const templateTarget = templateTargetOf(row);
  return {
    document,
    rev: documentVersionOf(row),
    ...(templateTarget === undefined ? {} : { templateTarget }),
  };
}

/**
 * A slug from the title, with a random suffix so two rows named alike never
 * collide on the unique column; a title `slugify` cannot spell yields the
 * suffix alone.
 */
export function derivedSlug(title: string): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  const derived = slugify(title);
  return derived === "" ? `component-${suffix}` : `${derived}-${suffix}`;
}

/** The id of a row the collection service created, or the failure it is. */
export function createdId(item: unknown): string {
  const id = (item as { id?: unknown } | null)?.id;
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number") return String(id);
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "The row was created but could not be identified.",
    logMessage: "createEntry returned no usable id",
    logContext: { reason: "composition-created-no-id" },
  });
}

/**
 * Refuse, rolling back what the transaction made, when the stored page
 * changed since the action was planned against it, and give the page as read
 * here. The page is read again as late as the write allows, and the write
 * sends this read's version back, so an edit landing between the two is
 * refused by the update rather than overwritten.
 */
export async function requireUnchangedPage(
  readNow: () => Promise<StoredPageRead | null>,
  planned: BlockDocument
): Promise<StoredPageRead> {
  const now = await readNow();
  // The read itself, so a write planned from it sends its version and, for a
  // template, the collection it draws.
  if (now !== null && sameStoredValue(now.document, planned)) return now;
  throw NextlyError.conflict({
    reason: "state",
    message:
      "The page changed while this was being done to it. Nothing was written; try again.",
    logContext: { reason: "composition-page-changed" },
  });
}

/** Bring the indexes in line with each written document, after the commit. */
export async function reconcileAfterCommit(
  setup: CompositionRouteSetup,
  written: readonly { slug: string; documentId: string }[]
): Promise<void> {
  const reconcile = setup.reconcile?.();
  if (reconcile === undefined) return;
  const nextly = setup.directApi?.() ?? requireNextly();
  for (const target of written) {
    await reconcile({ ...target, nextly });
  }
}

/**
 * The error a planner refusal answers with: 422, with the planner's own cause
 * as the code, for the reason the save-as-pattern route gives. `issues`
 * name the exposure each refers to.
 */
export function planRefusal(
  refused: {
    readonly problem: PlanProblem;
    readonly issues?: readonly ValidationIssue[];
  },
  action: string
): NextlyError {
  const message = "The action cannot be run on this selection.";
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: message,
    publicData: {
      errors: [
        ...(refused.issues ?? []).map(issue => ({
          path: `exposure${issue.path}`,
          code: refused.problem,
          message: issue.message,
        })),
        { path: "selectedIds", code: refused.problem, message },
      ],
    },
    logMessage: `Refused a ${action} request`,
    logContext: { reason: `${action}-refused`, problem: refused.problem },
  });
}

/** A request body, parsed by `schema`, or the refusal naming what is wrong. */
export async function readBodyWith<T extends z.ZodType>(
  req: Request,
  schema: T,
  action: string
): Promise<z.infer<T>> {
  return parsedWith(await readJsonBody(req, action), schema);
}

/** A request's JSON body, or the refusal saying it is not one. */
export async function readJsonBody(
  req: Request,
  action: string
): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "body",
          code: "INVALID_TYPE",
          message: `The request is not a ${action} request.`,
        },
      ],
    });
  }
}

/**
 * What a schema reads: zod's own, from `nextly/zod` or from the builder's
 * published actions, without asking that both name one copy of zod.
 */
export interface InputSchema<T> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: T }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly path: readonly PropertyKey[];
            readonly message: string;
          }[];
        };
      };
}

/**
 * `raw` parsed by `schema`, or the refusal naming what is wrong, each issue's
 * path under `at` when the value sits inside a larger request.
 */
export function parsedWith<T>(
  raw: unknown,
  schema: InputSchema<T>,
  at?: string
): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: parsed.error.issues.map(issue => ({
      path:
        [...(at === undefined ? [] : [at]), ...issue.path.map(String)].join(
          "."
        ) || "body",
      code: "INVALID",
      message: issue.message,
    })),
  });
}

/**
 * A request body's JSON Schema, as a client that does not run zod reads it:
 * the route's own envelope, with `action` the builder's schema for it. Built
 * from the envelope the route parses with, so what the manifest advertises
 * and what the route accepts are one schema.
 */
export function requestJsonSchema(
  envelope: z.ZodType,
  action: Record<string, unknown>
): Record<string, unknown> {
  const body = z.toJSONSchema(envelope, { io: "input" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const { $schema: _schema, ...actionBody } = action;
  return {
    ...body,
    properties: { ...body.properties, action: actionBody },
    // The envelope admits any `action`, so it does not list it; the route
    // then refuses a request without one.
    required: [...new Set([...(body.required ?? []), "action"])],
  };
}

/**
 * What an action answers before it becomes a response: the mutation
 * envelope's message and item. The route wraps it in `respondMutation`; the
 * service hands it back as it is.
 */
export interface ActionAnswer<T> {
  readonly message: string;
  readonly item: T;
  /**
   * What the committed write reported beyond its row: a side effect that
   * failed after the commit, or a notice. Present only when there is one. A
   * route's `respondMutation` reads the same warnings from the request, so a
   * caller of the service is told what a caller of the route is told, and
   * does not retry a write that is already durable.
   */
  readonly warnings?: WriteWarnings;
}

/** The warnings a committed write through the collection service reports. */
export type WriteWarnings = NonNullable<
  Awaited<
    ReturnType<PluginRouteContext["services"]["collections"]["updateEntry"]>
  >["warnings"]
>;
