/**
 * `nextly.workflows`: a document's review state, taking a step, assigning, what waits for the
 * caller, steps or assignments over several documents, and the registered workflows and their
 * settings, from server code.
 *
 * Each runs the operation the REST route runs (`api/workflows`), so one caller gets one answer
 * through either door. A trusted call (the Direct API's default, `overrideAccess: true`) takes a
 * step as the system, which may not approve or request changes, and no read check holds it back.
 * A checked call (`overrideAccess: false`) names who it is for, as a REST request is signed in,
 * and is held to the same read check and step rules as that request; one made for an API key
 * names the key, by `apiKeyId`.
 *
 * @module direct-api/namespaces/workflows
 * @experimental
 */
import type { PaginationMeta } from "../../api/response-shapes";
import type {
  DocumentReview,
  ManyRefusal,
  WaitingPart,
} from "../../domains/workflows/review-api";
import type { ReviewDocument } from "../../domains/workflows/review-state-repository";
import type {
  AssignResult,
  TakeStepResult,
} from "../../domains/workflows/steps";
import type {
  WorkflowSettingsChange,
  WorkflowSettingsView,
  WorkflowSummary,
} from "../../domains/workflows/workflow-settings-api";
import { NextlyError } from "../../errors";
import type { DirectAPIConfig, RunAsPrincipal } from "../types/shared";

import type { NextlyContext } from "./context";
import { checkedCaller, runAsCaller } from "./helpers";

/** Who a call is made for, beyond the Direct API's own options. @experimental */
export interface WorkflowCallArgs extends DirectAPIConfig, RunAsPrincipal {
  /** The API key a checked call is made for, by its id, where it is made for one. */
  apiKeyId?: string;
}

/** A document, as a call names it: an entry of a collection, or a Single. @experimental */
export type WorkflowDocumentRef =
  | { collection: string; id: string }
  | { single: string };

/** A part as the caller saw it: its review-state revision and the document's version. */
export interface WorkflowSeenPart {
  part: string | null;
  revision: number;
  version: string;
}

/** @experimental */
export interface WorkflowsNamespace {
  /** The document's review state, part by part. */
  reviewState(
    args: WorkflowCallArgs & { document: WorkflowDocumentRef }
  ): Promise<DocumentReview>;
  /** Take one step on one document, as the caller saw its parts. */
  takeStep(
    args: WorkflowCallArgs & {
      document: WorkflowDocumentRef;
      step: string;
      parts: (string | null)[] | "all";
      seen: WorkflowSeenPart[];
      comment?: string | null;
    }
  ): Promise<TakeStepResult>;
  /** Assign parts, all or nothing. */
  assign(
    args: WorkflowCallArgs & { assignments: WorkflowAssignmentInput[] }
  ): Promise<AssignResult>;
  /** One step over several documents; an approval is refused before anything moves. */
  stepMany(
    args: WorkflowCallArgs & {
      step: string;
      comment?: string | null;
      documents: {
        document: WorkflowDocumentRef;
        parts: (string | null)[] | "all";
        seen: WorkflowSeenPart[];
      }[];
    }
  ): Promise<{
    moved: { document: ReviewDocument; result: TakeStepResult }[];
    refused: ManyRefusal[];
  }>;
  /** Assignments over several documents, each document's made or refused on its own. */
  assignMany(
    args: WorkflowCallArgs & { assignments: WorkflowAssignmentInput[] }
  ): Promise<{ assigned: ReviewDocument[]; refused: ManyRefusal[] }>;
  /** What waits for the caller, a page at a time. A checked call only: it names who waits. */
  waiting(
    args: WorkflowCallArgs & { page?: number; limit?: number }
  ): Promise<{ items: WaitingPart[]; meta: PaginationMeta }>;
  /** The registered workflows, each with its stages, steps and attachments. */
  list(
    args?: WorkflowCallArgs
  ): Promise<{ items: WorkflowSummary[]; meta: PaginationMeta }>;
  /** A workflow's settings: read them, or change them over the revision read. */
  settings: WorkflowSettingsNamespace;
}

/** `nextly.workflows.settings`. @experimental */
export interface WorkflowSettingsNamespace {
  /** The workflow's settings, as they read now. */
  read(
    args: WorkflowCallArgs & { slug: string }
  ): Promise<WorkflowSettingsView>;
  /**
   * Change the workflow's settings over `revision`, the one read; each part named is merged into
   * what is stored. A part of the definition named is refused, as is a stale revision.
   */
  update(
    args: WorkflowCallArgs & { slug: string } & WorkflowSettingsChange
  ): Promise<WorkflowSettingsView>;
}

/**
 * Every option a call is made with rather than the change it asks for, by name: one entry for each
 * key of `WorkflowCallArgs`, which the type requires, so an option the call gains and this leaves
 * out fails to compile. Everything else in a settings update's arguments is the change, passed on
 * whole so a part the change may not name is refused rather than dropped.
 */
const CALL_OPTION_KEYS = {
  overrideAccess: true,
  trusted: true,
  enforceFieldAccess: true,
  fieldAccessUser: true,
  user: true,
  actor: true,
  req: true,
  context: true,
  request: true,
  showHiddenFields: true,
  disableErrors: true,
  disableTransaction: true,
  depth: true,
  richTextFormat: true,
  richTextStyles: true,
  overrideLock: true,
  forms: true,
  locale: true,
  fallbackLocale: true,
  principal: true,
  apiKeyId: true,
} as const satisfies Record<keyof WorkflowCallArgs, true>;

const CALL_OPTIONS: ReadonlySet<string> = new Set(
  Object.keys(CALL_OPTION_KEYS)
);

/**
 * A settings update's arguments without the options the call is made with: the change it asks
 * for, passed on whole.
 *
 * @experimental
 */
export function settingsChangeOf(
  args: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => !CALL_OPTIONS.has(key))
  );
}

/** One assignment, as a call names it. @experimental */
export interface WorkflowAssignmentInput {
  document: WorkflowDocumentRef;
  part: string | null;
  revision: number;
  assignee: { kind: "user" | "role"; id: string } | null;
  dueAt?: Date | null;
}

/** @experimental */
export function createWorkflowsNamespace(
  ctx: NextlyContext
): WorkflowsNamespace {
  const defaultConfig = ctx.defaultConfig;

  /** The operations, loaded when first used, and who the call is for: null for trusted code. */
  async function prepared(args: WorkflowCallArgs) {
    const operations = await import("../../api/workflows");
    const auth = checkedCaller(defaultConfig, args);
    const asker =
      auth === null
        ? null
        : await operations.workflowAskerOf(auth, args.apiKeyId);
    return { operations: operations.workflowOperations, asker };
  }

  return {
    reviewState: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.reviewState(asker, a.document);
      }),
    takeStep: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.takeStep(asker, {
          document: a.document,
          step: a.step,
          parts: a.parts,
          seen: a.seen,
          ...(a.comment === undefined ? {} : { comment: a.comment }),
        });
      }),
    assign: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.assign(asker, { assignments: a.assignments });
      }),
    stepMany: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.stepMany(asker, {
          step: a.step,
          documents: a.documents,
          ...(a.comment === undefined ? {} : { comment: a.comment }),
        });
      }),
    assignMany: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.assignMany(asker, {
          assignments: a.assignments,
        });
      }),
    waiting: args =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        if (asker === null) {
          throw NextlyError.validation({
            errors: [
              {
                path: "user",
                code: "WORKFLOW_WAITING_NEEDS_A_CALLER",
                message:
                  "What waits is read for someone: make the call with `overrideAccess: false` and a `user`.",
              },
            ],
          });
        }
        return operations.waiting(asker, {
          ...(a.page === undefined ? {} : { page: a.page }),
          ...(a.limit === undefined ? {} : { limit: a.limit }),
        });
      }),
    list: (args = {}) =>
      runAsCaller(defaultConfig, args, async a => {
        const { operations, asker } = await prepared(a);
        return operations.list(asker);
      }),
    settings: {
      read: args =>
        runAsCaller(defaultConfig, args, async a => {
          const { operations, asker } = await prepared(a);
          return operations.readSettings(asker, { slug: a.slug });
        }),
      update: args =>
        runAsCaller(defaultConfig, args, async a => {
          const { operations, asker } = await prepared(a);
          return operations.updateSettings(asker, settingsChangeOf(a));
        }),
    },
  };
}
