/**
 * The workflows a running install has registered: each attached workflow,
 * with its definition hash, the configuration file that registers it, and
 * the collections and Singles it is attached to.
 *
 * Built at boot and on every hot reload from the configuration as loaded,
 * plugins' contributions included, and checked in full there, before any of
 * it is written: whether each attachment can keep drafts is asked of the
 * draft split's own predicate, with the configuration's components and the
 * registry's.
 *
 * @module domains/workflows/registry
 * @experimental
 */

import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors";
import {
  evaluateDraftSplitEligibility,
  type DraftSplitDisabledReason,
  type DraftSplitEligibility,
} from "../versions/draft-split-eligibility";
import { resolveVersionsConfig } from "../versions/resolve-config";
import { resolveComponentSchemas } from "../versions/restore-version";

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
  DraftSplitDisabledReason | "drafts-off",
  (component: string | null) => string
> = {
  "drafts-off": () =>
    "it does not keep drafts: set `status: true` and `versions: { drafts: true }`.",
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
 * A component as the configuration defines it: what the draft split reads of
 * one before, or instead of, the registry.
 *
 * @experimental
 */
export interface ConfiguredComponent {
  slug: string;
  fields: readonly FieldConfig[];
  localized?: boolean;
}

/**
 * Where an attachment's components are read from.
 *
 * @experimental
 */
export interface WorkflowComponentSource {
  /**
   * The components the configuration defines, judged as written: they may not
   * be synced to the registry yet, or may be changing in this very reload.
   */
  components?: readonly ConfiguredComponent[];
  /**
   * Whether a component the configuration does not define, such as one made
   * in the admin, is read from the registry. Off where no database is read (a
   * build); such a component is then judged at boot.
   */
  readRegistry?: boolean;
}

/**
 * Whether `target` can keep drafts, by the draft split's own predicate, with
 * its components read from `source`. The one place an attachment's
 * eligibility is decided.
 */
async function draftSplitOf(
  target: WorkflowTarget,
  kind: "collection" | "single",
  source: WorkflowComponentSource
): Promise<DraftSplitEligibility> {
  const versions = resolveVersionsConfig(target.versions, target.status);
  const input = {
    collectionHasStatus: target.status === true,
    draftsVersioningEnabled: versions?.drafts.enabled === true,
    fields: [...target.fields],
    entityKind: kind,
    documentLocalized: target.localized === true,
  };
  // The predicate stops at those first, so a target they already refuse
  // reads no components.
  const asks = input.collectionHasStatus && input.draftsVersioningEnabled;
  return evaluateDraftSplitEligibility({
    ...input,
    componentSchemas: asks
      ? // No executor: a registry read here is not part of a transaction's
        // own writes, so the pooled connection is the right one.
        await resolveComponentSchemas(input.fields, undefined, {
          known: new Map(
            (source.components ?? []).map(component => [
              component.slug,
              {
                fields: [...component.fields],
                localized: component.localized === true,
                resolved: true,
              },
            ])
          ),
          readRegistry: source.readRegistry !== false,
        })
      : null,
  });
}

/** The one problem with an attachment the server can see, or `null`. */
async function eligibilityProblem(
  target: WorkflowTarget,
  kind: "collection" | "single",
  source: WorkflowComponentSource
): Promise<string | null> {
  const result = await draftSplitOf(target, kind, source);
  if (result.eligible) return null;
  return NOT_ELIGIBLE[result.reason ?? "drafts-off"](result.componentSlug);
}

/** Every attachment the server refuses, each at its place. */
async function serverProblems(
  config: {
    collections?: readonly WorkflowTarget[];
    singles?: readonly WorkflowTarget[];
  },
  source: WorkflowComponentSource
): Promise<Array<{ path: string; code: string; message: string }>> {
  const problems: Array<{ path: string; code: string; message: string }> = [];
  const lists = [
    ["collections", "collection", config.collections ?? []],
    ["singles", "single", config.singles ?? []],
  ] as const;
  for (const [root, kind, targets] of lists) {
    for (const target of targets) {
      if (target.workflow === undefined) continue;
      const why = await eligibilityProblem(target, kind, source);
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
 * attachment cannot keep drafts or two definitions share a slug. Reads
 * nothing but the registry, so a caller can judge a configuration before it
 * writes any of it.
 *
 * @experimental
 */
export async function buildWorkflowRegistry(
  config: {
    collections?: readonly WorkflowTarget[];
    singles?: readonly WorkflowTarget[];
  },
  configPath: string | null,
  source: WorkflowComponentSource = {}
): Promise<ReadonlyMap<string, RegisteredWorkflow>> {
  // The configuration's own checks first: plugins' collections never passed
  // through `defineConfig`.
  const attached = workflowAttachmentsOf(config);
  const problems = await serverProblems(config, source);
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
