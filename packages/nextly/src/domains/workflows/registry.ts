/**
 * The workflows a running install has registered: each attached workflow,
 * with its definition hash, the configuration file that registers it, and
 * the collections and Singles it is attached to.
 *
 * Built at boot and on every hot reload from the configuration as loaded,
 * plugins' contributions included, and checked in full there: what the
 * configuration alone cannot show (a password field, a component that cannot
 * keep a draft) is judged here, once the component registry is read.
 *
 * @module domains/workflows/registry
 * @experimental
 */

import { NextlyError } from "../../errors";
import {
  evaluateDraftSplitEligibility,
  schemaDraftSplit,
  type DraftSplitDisabledReason,
  type DraftSplitEligibility,
} from "../versions/draft-split-eligibility";
import { resolveVersionsConfig } from "../versions/resolve-config";

import { workflowAttachmentsOf, type WorkflowTarget } from "./attachments";
import { workflowDefinitionHash } from "./hash";
import type { Workflow } from "./types";

/**
 * A workflow as the install registered it.
 *
 * @experimental
 */
export interface RegisteredWorkflow {
  workflow: Workflow;
  /** sha256 of the workflow's structure (`workflowDefinitionHash`). */
  definitionHash: string;
  /** The `nextly.config.ts` that registers it, or `null` where none was found. */
  configPath: string | null;
  collections: readonly string[];
  singles: readonly string[];
}

/** What each draft-split refusal means for an attachment. */
const NOT_ELIGIBLE: Record<
  DraftSplitDisabledReason,
  (component: string | null) => string
> = {
  "lifecycle-disabled": () =>
    "it has no Draft/Published lifecycle: set `status: true`.",
  "password-field": component =>
    component === null
      ? "it has a password field, so it cannot keep a draft beside the live version."
      : `its component \`${component}\` has a password field, so it cannot keep a draft beside the live version.`,
  "unresolvable-component": component =>
    `its component \`${component ?? "?"}\` is not registered, so its drafts cannot be judged.`,
  "localized-component": component =>
    `it is not localized but reaches the localized component \`${component ?? "?"}\`, so one draft would hold several languages.`,
};

/**
 * Whether `target` can keep drafts, by the draft split's own rules. Its
 * components are judged only when `judgeComponents`: on a database not set up
 * yet the component registry cannot be read, so every component would read
 * as unregistered.
 */
async function draftSplitOf(
  target: WorkflowTarget,
  kind: "collection" | "single",
  judgeComponents: boolean
): Promise<DraftSplitEligibility> {
  const versions = resolveVersionsConfig(target.versions, target.status);
  if (!judgeComponents) {
    return evaluateDraftSplitEligibility({
      collectionHasStatus: target.status === true,
      draftsVersioningEnabled: versions?.drafts.enabled === true,
      fields: [...target.fields],
      componentSchemas: null,
      entityKind: kind,
      documentLocalized: target.localized === true,
    });
  }
  return schemaDraftSplit({
    status: target.status,
    versions,
    fields: [...target.fields],
    slug: target.slug,
    localized: target.localized === true,
    entityKind: kind,
  });
}

/** The one problem with an attachment the server can see, or `null`. */
async function eligibilityProblem(
  target: WorkflowTarget,
  kind: "collection" | "single",
  judgeComponents: boolean
): Promise<string | null> {
  const result = await draftSplitOf(target, kind, judgeComponents);
  if (result.eligible || result.reason === null) return null;
  return NOT_ELIGIBLE[result.reason](result.componentSlug);
}

/** Every attachment the server refuses, each at its place. */
async function serverProblems(
  config: {
    collections?: readonly WorkflowTarget[];
    singles?: readonly WorkflowTarget[];
  },
  judgeComponents: boolean
): Promise<Array<{ path: string; code: string; message: string }>> {
  const problems: Array<{ path: string; code: string; message: string }> = [];
  const lists = [
    ["collections", "collection", config.collections ?? []],
    ["singles", "single", config.singles ?? []],
  ] as const;
  for (const [root, kind, targets] of lists) {
    for (const target of targets) {
      if (target.workflow === undefined) continue;
      const why = await eligibilityProblem(target, kind, judgeComponents);
      if (why !== null) {
        problems.push({
          path: `${root}.${target.slug}.workflow`,
          code: "workflow_needs_drafts",
          message: `\`${target.workflow.slug}\` cannot be attached to \`${target.slug}\`: ${why}`,
        });
      }
    }
  }
  return problems;
}

/**
 * The registry for `config`: each attached workflow with its hash, path and
 * attachments. Refuses the configuration, every problem listed, when an
 * attachment cannot keep drafts or two definitions share a slug.
 *
 * @experimental
 */
export async function buildWorkflowRegistry(
  config: {
    collections?: readonly WorkflowTarget[];
    singles?: readonly WorkflowTarget[];
  },
  configPath: string | null,
  options: { judgeComponents?: boolean } = {}
): Promise<ReadonlyMap<string, RegisteredWorkflow>> {
  // The configuration's own checks first: plugins' collections never passed
  // through `defineConfig`.
  const attached = workflowAttachmentsOf(config);
  const problems = await serverProblems(
    config,
    options.judgeComponents !== false
  );
  if (problems.length > 0) {
    throw NextlyError.validation({ errors: problems });
  }
  return new Map(
    attached.map(entry => [
      entry.workflow.slug,
      {
        workflow: entry.workflow,
        definitionHash: workflowDefinitionHash(entry.workflow),
        configPath,
        collections: entry.collections,
        singles: entry.singles,
      },
    ])
  );
}

let registered: ReadonlyMap<string, RegisteredWorkflow> = new Map();

/**
 * Make `next` the install's registry, and answer the one it replaces, so a
 * hot reload that is rolled back can put it back.
 *
 * @experimental
 */
export function publishWorkflows(
  next: ReadonlyMap<string, RegisteredWorkflow>
): ReadonlyMap<string, RegisteredWorkflow> {
  const previous = registered;
  registered = next;
  return previous;
}

/**
 * The registry in force, so a hot reload can put it back if it does not land.
 *
 * @experimental
 */
export function publishedWorkflows(): ReadonlyMap<string, RegisteredWorkflow> {
  return registered;
}

/**
 * Every registered workflow.
 *
 * @experimental
 */
export function registeredWorkflows(): RegisteredWorkflow[] {
  return [...registered.values()];
}

/**
 * The workflow a collection or Single is attached to, or `undefined`.
 *
 * @experimental
 */
export function workflowAttachedTo(
  kind: "collection" | "single",
  slug: string
): RegisteredWorkflow | undefined {
  return registeredWorkflows().find(entry =>
    (kind === "collection" ? entry.collections : entry.singles).includes(slug)
  );
}
