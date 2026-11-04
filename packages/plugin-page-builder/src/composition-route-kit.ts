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
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { slugify } from "nextly";
import { requireNextly } from "nextly/runtime";
import type { z } from "nextly/zod";

import type { CommittedWriteReconciler } from "./class-usage-hook";
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import { COMPONENTS_SLUG } from "./collections/components";
import type { ActionBy } from "./component-actions-contract";
import type { ComponentStore } from "./library-route";

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
  asks: readonly (readonly [action: string, resource: string])[] = []
): Promise<ActionBy> {
  const { user, caller } = ctx;
  let allowed = user !== null && caller !== null;
  for (const [action, resource] of asks) {
    if (!allowed) break;
    allowed = (await caller?.can(action, resource)) === true;
  }
  if (!allowed || user === null || caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "composition-action-not-granted", asks },
    });
  }
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
    as: "user" as const,
    user: ctx.user ?? undefined,
    ...(ctx.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: ctx.authenticatedScope }),
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

/** A row's blocks field, or `null` when it holds none. */
export function blocksDocumentOf(
  row: unknown,
  field: string
): BlockDocument | null {
  const value = (row as Record<string, unknown> | null)?.[field];
  return value === undefined || value === null
    ? null
    : (value as BlockDocument);
}

/**
 * The key a read gives a document's version under, and an update sends it
 * back under: the update then applies only to the version it was read from.
 */
export const DOCUMENT_VERSION_KEY = "_rev";

/** A stored page's blocks document, and the version of the read it came from. */
export interface StoredPageRead {
  readonly document: BlockDocument;
  /** The row's version as read; absent from a server that issues none. */
  readonly rev: string | undefined;
}

/** A row's version, as a read gave it, or `undefined` when it gave none. */
export function documentVersionOf(row: unknown): string | undefined {
  const value = (row as Record<string, unknown> | null)?.[DOCUMENT_VERSION_KEY];
  return typeof value === "string" ? value : undefined;
}

/** A row's blocks field with the row's version, or `null` when it holds none. */
export function storedPageReadOf(
  row: unknown,
  field: string
): StoredPageRead | null {
  const document = blocksDocumentOf(row, field);
  return document === null ? null : { document, rev: documentVersionOf(row) };
}

/**
 * The data of an update made from a read: it carries the version that read
 * gave, so a save made since refuses it rather than being overwritten.
 */
export function withVersionFrom(
  data: Record<string, unknown>,
  rev: string | undefined
): Record<string, unknown> {
  return rev === undefined ? data : { ...data, [DOCUMENT_VERSION_KEY]: rev };
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
 * changed since the action was planned against it, and give the version of
 * the page as read here. The page is read again as late as the write allows,
 * and the write sends this read's version back, so an edit landing between
 * the two is refused by the update rather than overwritten.
 */
export async function requireUnchangedPage(
  readNow: () => Promise<StoredPageRead | null>,
  planned: BlockDocument
): Promise<string | undefined> {
  const now = await readNow();
  if (now !== null && sameStoredValue(now.document, planned)) return now.rev;
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
  let raw: unknown;
  try {
    raw = await req.json();
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
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: parsed.error.issues.map(issue => ({
      path: issue.path.join(".") || "body",
      code: "INVALID",
      message: issue.message,
    })),
  });
}
