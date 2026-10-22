/**
 * Which collections and Singles a workflow is attached to, and whether each
 * attachment is a sound workflow from `defineWorkflow`.
 *
 * Pure, and reaching no server module, because `defineConfig` runs it and
 * `nextly/config` is a client entry. Whether a collection or Single can keep
 * the drafts a workflow needs is not judged here: it is the draft split's own
 * question, asked once, by the registry at boot, on hot reload and in
 * `nextly build` (`registry.ts`).
 *
 * @module domains/workflows/attachments
 * @experimental
 */

import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors";
import type { VersionsConfig } from "../../schemas/versions/types";
import { canonicalJson } from "../../shared/lib/canonical-json";

import { workflowProblems } from "./define-workflow";
import type { Workflow } from "./types";

/**
 * A collection or Single as the configuration declares it, with the parts an
 * attachment is judged by.
 *
 * @experimental
 */
export interface WorkflowTarget {
  slug: string;
  status?: boolean;
  versions?: boolean | VersionsConfig;
  localized?: boolean;
  fields: readonly FieldConfig[];
  workflow?: Workflow;
}

/**
 * One workflow's place in the configuration: the workflow and what it is
 * attached to.
 *
 * @experimental
 */
export interface WorkflowAttachments {
  workflow: Workflow;
  collections: string[];
  singles: string[];
}

/** One problem, at its place in the configuration. */
interface AttachmentProblem {
  path: string;
  code: string;
  message: string;
}

/**
 * The problems with one attachment, at `path`: a value not from
 * `defineWorkflow`, or a definition that does not pass its checks.
 */
function attachmentProblems(
  target: WorkflowTarget & { workflow: Workflow },
  path: string
): AttachmentProblem[] {
  if (target.workflow.kind !== "nextly-workflow") {
    return [
      {
        path,
        code: "workflow_not_defined",
        message: "Pass a workflow from `defineWorkflow` or `reviewWorkflow`.",
      },
    ];
  }
  // Checked again here, whatever its marker says: a value built by hand
  // carries the same marker without having been through `defineWorkflow`.
  return workflowProblems(target.workflow).map(problem => ({
    ...problem,
    path: problem.path === "" ? path : `${path}.${problem.path}`,
  }));
}

/** The problems with each attachment of one kind of target. */
function targetProblems(
  targets: readonly WorkflowTarget[],
  root: "collections" | "singles"
): AttachmentProblem[] {
  return targets.flatMap(target =>
    target.workflow === undefined
      ? []
      : attachmentProblems(
          { ...target, workflow: target.workflow },
          `${root}.${target.slug}.workflow`
        )
  );
}

/**
 * Every workflow the configuration attaches, once each, with what it is
 * attached to. Two different definitions under one slug are refused: Settings
 * and the record name a workflow by its slug.
 */
function collect(
  collections: readonly WorkflowTarget[],
  singles: readonly WorkflowTarget[],
  problems: AttachmentProblem[]
): WorkflowAttachments[] {
  const bySlug = new Map<string, WorkflowAttachments>();
  const add = (target: WorkflowTarget, list: "collections" | "singles") => {
    const workflow = target.workflow;
    if (workflow?.kind !== "nextly-workflow") return;
    const entry = bySlug.get(workflow.slug);
    if (entry === undefined) {
      bySlug.set(workflow.slug, {
        workflow,
        collections: list === "collections" ? [target.slug] : [],
        singles: list === "singles" ? [target.slug] : [],
      });
      return;
    }
    if (canonicalJson(entry.workflow) !== canonicalJson(workflow)) {
      problems.push({
        path: `${list}.${target.slug}.workflow`,
        code: "workflow_slug_taken",
        message: `Another workflow is already named \`${workflow.slug}\`; give each definition its own slug.`,
      });
      return;
    }
    entry[list].push(target.slug);
  };
  for (const target of collections) add(target, "collections");
  for (const target of singles) add(target, "singles");
  return [...bySlug.values()];
}

/**
 * The configuration's workflows and their attachments, refusing a value that
 * is not a sound workflow and two definitions sharing a slug. Each error
 * names its place (`collections.posts.workflow`).
 *
 * @experimental
 */
export function workflowAttachmentsOf(config: {
  collections?: readonly WorkflowTarget[];
  singles?: readonly WorkflowTarget[];
}): WorkflowAttachments[] {
  const collections = config.collections ?? [];
  const singles = config.singles ?? [];
  const problems = [
    ...targetProblems(collections, "collections"),
    ...targetProblems(singles, "singles"),
  ];
  const attached = collect(collections, singles, problems);
  if (problems.length > 0) {
    throw NextlyError.validation({ errors: problems });
  }
  return attached;
}
