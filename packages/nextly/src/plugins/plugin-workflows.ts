/**
 * `ctx.services.workflows`: what a plugin acting for a person or an API key may do with review
 * state. It reads a document's review state, what waits for its caller and a workflow's
 * definition, and submits for review; it takes no other step, assigns nothing and changes no
 * setting.
 *
 * Every call is made for the caller the plugin names (`{ as: "user", user }`), judged by the one
 * gate the REST routes and the Direct API use (`workflowOperations`): the person, or the API key
 * the plugin route's request authenticated with, by its own scope and named by its own id, which
 * core takes from the request and never from the plugin. The plugin acting as itself, a visitor
 * and a plugin-defined person are refused: review state is told and moved for someone.
 *
 * @module plugins/plugin-workflows
 * @experimental
 */

import { z } from "zod";

import type { PaginationMeta } from "../api/response-shapes";
import type { WorkflowAsker } from "../api/workflows";
import { nextlyValidationFromZod } from "../api/zod-to-nextly-error";
import {
  currentCallerScope,
  currentRouteActor,
  runWithCallerScope,
} from "../auth/caller-scope";
import { runAsPrincipal } from "../auth/principal-scope";
import { checkedCaller } from "../direct-api/namespaces/helpers";
import type {
  DocumentReview,
  WaitingPart,
} from "../domains/workflows/review-api";
import type { TakeStepResult } from "../domains/workflows/steps";
import type { WorkflowDefinition } from "../domains/workflows/workflow-settings-api";
import { NextlyError } from "../errors/nextly-error";
import { deepEqual } from "../shared/lib/deep-equal";

import { resolveServiceOpts, type ServiceOpts } from "./service-opts";

/**
 * A document, as a call names it: an entry of a collection, or a Single. The plugin SDK names
 * this and the types below from the service's own signature, so they are kept here unexported.
 */
type PluginWorkflowDocumentRef =
  | { collection: string; id: string }
  | { single: string };

/**
 * The reference a read takes for a document the store keys by kind, slug and id: a Single is
 * named by its slug alone, as the reads name it, since it has one document.
 */
function documentRefOf(
  document: WaitingPart["document"]
): PluginWorkflowDocumentRef {
  return document.scopeKind === "single"
    ? { single: document.scopeSlug }
    : { collection: document.scopeSlug, id: document.entryId };
}

/** @experimental A collection or a Single, by its slug. */
type PluginWorkflowEntityRef = { collection: string } | { single: string };

/**
 * @experimental A part waiting for the caller. Its document is named as a read names one, so the
 * item can be handed straight to `reviewState` or `submit`, not by the store's own key for it.
 */
type PluginWorkflowWaitingItem = Omit<WaitingPart, "document"> & {
  document: PluginWorkflowDocumentRef;
};

/** @experimental A part as the caller saw it: its review-state revision and the document's version. */
interface PluginWorkflowSeenPart {
  /** A language, or null for the shared part. */
  part: string | null;
  revision: number;
  version: string;
}

/**
 * @experimental A submit for review: the parts named one by one, each as the caller saw it, and
 * the comment the caller leaves. `step` names the submit step; left out, it is the submit step
 * out of the parts' stage.
 */
interface PluginWorkflowSubmitInput {
  document: PluginWorkflowDocumentRef;
  parts: (string | null)[];
  seen: PluginWorkflowSeenPart[];
  comment: string;
  step?: string;
}

/** @experimental A page of what waits for the caller: page 1 and 20 items unless named. */
interface PluginWorkflowWaitingQuery {
  page?: number;
  limit?: number;
}

/** @experimental A document's review state, part by part. */
type PluginWorkflowReview = DocumentReview;

/** @experimental A workflow's stages and steps, as its definition names them. */
type PluginWorkflowDefinition = WorkflowDefinition;

/**
 * @experimental `ctx.services.workflows`. Each call names who it is for in `opts`
 * (`{ as: "user", user }`); one that names no user, or runs as the system or the public, is
 * refused with `AUTH_REQUIRED`.
 */
export interface PluginWorkflowsService {
  /**
   * The workflow attached to a collection or Single, `null` when none is: its stages and steps,
   * without its settings or what else it is attached to. Not found unless the caller may read
   * the collection or Single.
   */
  definitionOf(
    entity: PluginWorkflowEntityRef,
    opts?: ServiceOpts
  ): Promise<{ workflow: PluginWorkflowDefinition | null }>;
  /**
   * A document's review state, part by part, each step marked with whether the caller may take
   * it. Not found unless the caller may read the document; a part in a language the caller may
   * not read it in is left out.
   */
  reviewState(
    input: { document: PluginWorkflowDocumentRef },
    opts?: ServiceOpts
  ): Promise<PluginWorkflowReview>;
  /**
   * What waits for the caller, a page at a time: parts assigned to them in a stage whose step
   * they may take, in documents they may read.
   */
  waiting(
    query?: PluginWorkflowWaitingQuery,
    opts?: ServiceOpts
  ): Promise<{ items: PluginWorkflowWaitingItem[]; meta: PaginationMeta }>;
  /**
   * Submit parts of a document for review, with a comment a reviewer reads. Only a step of kind
   * `submit`: any other is refused with `WORKFLOW_STEP_NOT_SUBMIT`, and with no step named, a
   * stage no submit step leaves with `WORKFLOW_NO_SUBMIT_STEP`. Not found unless the caller may
   * read the document in each part named; then held to the step's own rules.
   */
  submit(
    input: PluginWorkflowSubmitInput,
    opts?: ServiceOpts
  ): Promise<TakeStepResult>;
}

/** The operations, loaded when first used, as the Direct API loads them. */
const operations = () => import("../api/workflows");

/** The shapes the operations name their input in. */
type WorkflowInputShapes = Awaited<
  ReturnType<typeof operations>
>["workflowInputShapes"];

/** A page of what waits, strictly: no other key, and the bounds the operation keeps. */
const WaitingInput = z
  .object({
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

/**
 * A submit as a plugin makes it, stricter than the operation's own body and built from its
 * shapes: each part named (never every part at once), what was seen of each, and a comment that
 * is more than blanks. The operation keeps the comment to its own length limit.
 */
const submitInputOf = (shapes: WorkflowInputShapes) =>
  z
    .object({
      document: shapes.DocumentRef,
      parts: z.array(shapes.Part).min(1).max(500),
      seen: z.array(shapes.Seen).min(1).max(500),
      comment: z.string().trim().min(1),
      step: z.string().min(1).optional(),
    })
    .strict();

/** Parsed at the boundary: an input that does not fit is the plugin's mistake. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw nextlyValidationFromZod(result.error);
  return result.data;
}

/**
 * Refuses a scope a plugin hands the service on a request an API key authenticated, unless it is
 * that key's own. A key always acts with its own scope: a move is recorded as the key's, so a
 * scope a plugin supplied, wider or merely different, would act with grants the key does not
 * hold under the key's name. Forbidden, with nothing of either scope in the answer. A request a
 * person signed in to, or a call outside any request, is left to the checks after it.
 */
function refuseAnotherScopeForTheKey(opts: ServiceOpts | undefined): void {
  const supplied = opts?.authenticatedScope;
  if (supplied === undefined) return;
  if (currentRouteActor()?.actor.type !== "apiKey") return;
  if (deepEqual(supplied, currentCallerScope())) return;
  throw NextlyError.forbidden({
    logContext: { reason: "plugin-workflows-scope-not-the-keys-own" },
  });
}

/**
 * Runs `work` for the caller `opts` names, as the asker the REST routes build for them: resolved
 * by the rule every plugin service uses, then asked the Direct API's question of who a checked
 * call is for, so a call naming nobody, the system or the public is refused. A key is the one the
 * plugin route's request authenticated with: its scope as resolved, its id from the request's
 * actor. A scope with no key actor beside it (a call made outside the key's own request, or for
 * another user) names no key, and the asker refuses it. Run in a frame of its own with that
 * scope, as `services.collections` runs its calls.
 */
async function asAsker<T>(
  opts: ServiceOpts | undefined,
  work: (asker: NonNullable<WorkflowAsker>) => Promise<T>
): Promise<T> {
  refuseAnotherScopeForTheKey(opts);
  const resolved = await resolveServiceOpts(opts ?? {});
  const auth = checkedCaller(
    {},
    {
      overrideAccess: resolved.overrideAccess,
      user: resolved.user,
      actor: resolved.authenticatedScope,
    }
  );
  if (auth === null) {
    throw NextlyError.authRequired({
      logContext: { reason: "plugin-workflows-call-names-no-user" },
    });
  }
  const keyId =
    resolved.authenticatedScope !== undefined &&
    resolved.actor?.type === "apiKey"
      ? resolved.actor.id
      : undefined;
  return runAsPrincipal(null, () =>
    runWithCallerScope(resolved.authenticatedScope, async () => {
      const { workflowAskerOf } = await operations();
      return work(await workflowAskerOf(auth, keyId));
    })
  );
}

/**
 * The service a plugin is handed. Each input is parsed, strictly, before the caller is resolved,
 * so a malformed call is refused as such whoever makes it; the shapes are the operations' own.
 *
 * @experimental
 */
export function pluginWorkflowsService(): PluginWorkflowsService {
  return Object.freeze({
    async definitionOf(entity, opts) {
      const { workflowOperations, workflowInputShapes } = await operations();
      const ref = parse(workflowInputShapes.EntityRef, entity);
      return asAsker(opts, asker =>
        workflowOperations.definitionOf(asker, ref)
      );
    },
    async reviewState(input, opts) {
      const { workflowOperations, workflowInputShapes } = await operations();
      const { document } = parse(
        z.object({ document: workflowInputShapes.DocumentRef }).strict(),
        input
      );
      return asAsker(opts, asker =>
        workflowOperations.reviewState(asker, document)
      );
    },
    async waiting(query, opts) {
      const page = parse(WaitingInput, query ?? {});
      const { workflowOperations } = await operations();
      const listed = await asAsker(opts, asker =>
        workflowOperations.waiting(asker, page)
      );
      return {
        ...listed,
        items: listed.items.map(item => ({
          ...item,
          document: documentRefOf(item.document),
        })),
      };
    },
    async submit(input, opts) {
      const { workflowOperations, workflowInputShapes } = await operations();
      const body = parse(submitInputOf(workflowInputShapes), input);
      return asAsker(opts, asker => workflowOperations.submit(asker, body));
    },
  } satisfies PluginWorkflowsService);
}
