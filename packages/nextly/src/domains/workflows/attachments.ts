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
import {
  PUBLISH_WITHOUT_REVIEW,
  workflowPermissionActions,
} from "./permissions";
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
  root: "collections" | "singles",
  slugs: ReadonlySet<string>
): AttachmentProblem[] {
  return targets.flatMap(target => {
    if (target.workflow === undefined) return [];
    const path = `${root}.${target.slug}.workflow`;
    const problems = attachmentProblems(
      { ...target, workflow: target.workflow },
      path
    );
    return problems.length > 0
      ? problems
      : permissionProblems(target.workflow, target.slug, path, slugs);
  });
}

/** The longest slug a permission stores (`permissions.slug`). */
const MAX_PERMISSION_SLUG_LENGTH = 100;

/**
 * Why the permissions the workflow seeds on `slug` cannot be stored as their own (see
 * `workflowPermissionActions`):
 *
 * - a slug too long for `permissions.slug`;
 * - `publish-without-review-<slug>` is also how `publish-<slug>` spells the publish permission of
 *   an entity named `without-review-<slug>`, and permission slugs are unique, so the two would be
 *   one row and a grant of either would be a grant of both.
 */
function permissionProblems(
  workflow: Workflow,
  slug: string,
  path: string,
  slugs: ReadonlySet<string>
): AttachmentProblem[] {
  const problems: AttachmentProblem[] = [];
  const twin = `without-review-${slug}`;
  if (slugs.has(twin)) {
    problems.push({
      path,
      code: "workflow_permission_collides",
      message: `\`${PUBLISH_WITHOUT_REVIEW}-${slug}\` would also be the publish permission of \`${twin}\`; rename one of the two before attaching a workflow to \`${slug}\`.`,
    });
  }
  for (const action of workflowPermissionActions(workflow)) {
    const permission = `${action}-${slug}`;
    if (permission.length > MAX_PERMISSION_SLUG_LENGTH) {
      problems.push({
        path,
        code: "workflow_permission_too_long",
        message: `\`${permission}\` is too long to store as a permission: shorten the step's action or the slug to at most ${String(MAX_PERMISSION_SLUG_LENGTH)} characters together.`,
      });
    }
  }
  return problems;
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
  // Every entity's slug, which a seeded permission's slug must not collide with.
  const slugs = new Set(
    [...collections, ...singles].map(target => target.slug)
  );
  const problems = [
    ...targetProblems(collections, "collections", slugs),
    ...targetProblems(singles, "singles", slugs),
  ];
  const attached = collect(collections, singles, problems);
  if (problems.length > 0) {
    throw NextlyError.validation({ errors: problems });
  }
  return attached;
}
