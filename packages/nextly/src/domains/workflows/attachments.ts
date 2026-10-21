/**
 * Which collections and Singles a workflow is attached to, and whether each
 * may have one.
 *
 * A workflow decides when pending content may be published, so it needs the
 * content kept as a draft beside the live version. A collection or Single
 * without that is refused when the configuration is assembled, saying which
 * condition it misses. Pure, and reaching no server module, because
 * `defineConfig` runs it and `nextly/config` is a client entry: the parts of
 * the rule that need the server (a password field, a component) are judged
 * at boot and in `nextly build` (`attachment-eligibility`).
 *
 * @module domains/workflows/attachments
 * @experimental
 */

import type { FieldConfig } from "../../collections/fields/types";
import { NextlyError } from "../../errors";
import type { VersionsConfig } from "../../schemas/versions/types";
import { canonicalJson } from "../../shared/lib/canonical-json";
import { resolveVersionsConfig } from "../versions/resolve-config";

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
 * Why `target`'s configuration cannot keep drafts beside its live version,
 * or `null` when it asks for them: the lifecycle off, or drafts off.
 */
function draftsProblem(target: WorkflowTarget): string | null {
  if (target.status !== true) {
    return "it has no Draft/Published lifecycle: set `status: true`.";
  }
  const versions = resolveVersionsConfig(target.versions, target.status);
  if (versions?.drafts.enabled !== true) {
    return "it does not keep drafts: set `versions: { drafts: true }`.";
  }
  return null;
}

/**
 * The problems with one attachment, at `path`: a value not from
 * `defineWorkflow`, a definition that does not pass its checks, or a target
 * that cannot keep drafts.
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
  const unsound = workflowProblems(target.workflow);
  if (unsound.length > 0) {
    return unsound.map(problem => ({
      ...problem,
      path: problem.path === "" ? path : `${path}.${problem.path}`,
    }));
  }
  const why = draftsProblem(target);
  if (why === null) return [];
  return [
    {
      path,
      code: "workflow_needs_drafts",
      message: `\`${target.workflow.slug}\` cannot be attached to \`${target.slug}\`: ${why}`,
    },
  ];
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
 * The configuration's workflows and their attachments, refusing any
 * attachment to a collection or Single that cannot keep drafts beside the
 * live version, and two definitions sharing a slug. Each error names its
 * place (`collections.posts.workflow`) and what is missing.
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
