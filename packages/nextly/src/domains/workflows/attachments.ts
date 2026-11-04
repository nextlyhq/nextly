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
import { BUILT_IN_ACTIONS, workflowPermissionActions } from "./permissions";
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

/** An action on an entity, as a permission names it. */
interface PermissionOwner {
  action: string;
  entity: string;
}

/**
 * Every permission slug the config's entities are seeded with, by slug (lower case, as permissions
 * are matched): each entity's built-in actions, and each attached workflow's own
 * (`workflowPermissionActions`). Permission slugs are unique, so two owners under one slug would
 * be one row, and a grant of either would be a grant of both.
 */
function seededPermissionOwners(
  targets: readonly WorkflowTarget[]
): Map<string, PermissionOwner[]> {
  const owners = new Map<string, PermissionOwner[]>();
  const add = (action: string, entity: string) => {
    const key = `${action}-${entity}`.toLowerCase();
    owners.set(key, [...(owners.get(key) ?? []), { action, entity }]);
  };
  for (const target of targets) {
    for (const action of BUILT_IN_ACTIONS) add(action, target.slug);
    // Only a sound definition seeds anything; another one is refused on its own.
    const workflow = target.workflow;
    if (
      workflow !== undefined &&
      attachmentProblems({ ...target, workflow }, "").length === 0
    ) {
      for (const action of workflowPermissionActions(workflow)) {
        add(action, target.slug);
      }
    }
  }
  return owners;
}

/** The problems with each attachment of one kind of target. */
function targetProblems(
  targets: readonly WorkflowTarget[],
  root: "collections" | "singles",
  owners: ReadonlyMap<string, PermissionOwner[]>
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
      : permissionProblems(target.workflow, target.slug, path, owners);
  });
}

/** The longest slug a permission stores (`permissions.slug`). */
const MAX_PERMISSION_SLUG_LENGTH = 100;

/**
 * Why the permissions the workflow seeds on `slug` cannot be stored as their own (see
 * `workflowPermissionActions`):
 *
 * - a slug too long for `permissions.slug`;
 * - a slug another action on another entity is also seeded under (`seededPermissionOwners`), as
 *   `publish-without-review-posts` is also `publish` on an entity named `without-review-posts`.
 */
function permissionProblems(
  workflow: Workflow,
  slug: string,
  path: string,
  owners: ReadonlyMap<string, PermissionOwner[]>
): AttachmentProblem[] {
  const problems: AttachmentProblem[] = [];
  for (const action of workflowPermissionActions(workflow)) {
    const permission = `${action}-${slug}`;
    const others = (owners.get(permission.toLowerCase()) ?? []).filter(
      o => o.action !== action || o.entity !== slug
    );
    for (const other of others) {
      problems.push({
        path,
        code: "workflow_permission_collides",
        message: `\`${permission}\` would also be the \`${other.action}\` permission of \`${other.entity}\`; rename the step's action or one of the two entities before attaching a workflow to \`${slug}\`.`,
      });
    }
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
  // Every permission slug the entities are seeded with, which a workflow's own must not share.
  const owners = seededPermissionOwners([...collections, ...singles]);
  const problems = [
    ...targetProblems(collections, "collections", owners),
    ...targetProblems(singles, "singles", owners),
  ];
  const attached = collect(collections, singles, problems);
  if (problems.length > 0) {
    throw NextlyError.validation({ errors: problems });
  }
  return attached;
}
