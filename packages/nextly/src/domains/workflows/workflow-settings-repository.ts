/**
 * Read and write what admins change for a workflow on this environment
 * (`nextly_workflow_settings`): each stage's default reviewer, label and colour overrides, and
 * which notifications also send an email. The stages and steps are the code's and never stored.
 *
 * The settings are JSON text in the row, parsed here with `workflowSettingsSchema`, so a value the
 * code no longer understands is refused at the boundary rather than trusted past it. A write is a
 * compare-and-set on the row's `revision`.
 *
 * @module domains/workflows/workflow-settings-repository
 */
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import { WORKFLOW_SETTINGS_TABLE } from "../../schemas/workflow-settings";

import type { ReviewStatesDb } from "./review-state-repository";

/** What admins change for one workflow; every part optional, and absent when unchanged. */
const workflowSettingsSchema = z
  .object({
    /** Each stage's default reviewer, by stage name. */
    defaultReviewers: z
      .record(
        z.string(),
        z
          .object({ kind: z.enum(["user", "role"]), id: z.string().min(1) })
          .strict()
      )
      .optional(),
    /** Each stage's label and colour shown over the code's, by stage name. */
    stages: z
      .record(
        z.string(),
        z
          .object({
            label: z.string().min(1).optional(),
            colour: z.string().min(1).optional(),
          })
          .strict()
      )
      .optional(),
    /** Whether each notification also sends an email; on unless set false. */
    emails: z
      .object({
        assigned: z.boolean().optional(),
        approved: z.boolean().optional(),
        changesRequested: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

/** A workflow's stored settings and the revision they were read at. */
export interface StoredWorkflowSettings {
  settings: WorkflowSettings;
  revision: number;
}

interface WorkflowSettingsRow {
  settings: string;
  revision: number | string;
}

const byWorkflow = (workflow: string): WhereClause => ({
  and: [{ column: "workflow", op: "=", value: workflow }],
});

/** A workflow's stored settings, or null when admins have changed nothing for it. */
export async function readWorkflowSettings(
  db: ReviewStatesDb,
  workflow: string
): Promise<StoredWorkflowSettings | null> {
  const [row] = await db.select<WorkflowSettingsRow>(WORKFLOW_SETTINGS_TABLE, {
    where: byWorkflow(workflow),
    limit: 1,
  });
  if (!row) return null;
  return {
    settings: parseStored(workflow, row.settings),
    revision: Number(row.revision),
  };
}

/**
 * Stores a workflow's settings over the revision the caller read: `null` for a workflow with no
 * row yet, which creates it at revision 1. False, changing nothing, when the stored revision is
 * another; a concurrent first write is refused by the unique index on the workflow.
 *
 * @throws NextlyError `VALIDATION_ERROR` for settings outside `workflowSettingsSchema`
 */
export async function writeWorkflowSettings(
  db: ReviewStatesDb,
  workflow: string,
  settings: WorkflowSettings,
  expectedRevision: number | null,
  updatedBy: string | null
): Promise<boolean> {
  const parsed = workflowSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: ["settings", ...issue.path].join("."),
        code: "INVALID_WORKFLOW_SETTINGS",
        message: issue.message,
      })),
    });
  }
  const json = JSON.stringify(parsed.data);
  const now = new Date();
  if (expectedRevision === null) {
    const [existing] = await db.select<WorkflowSettingsRow>(
      WORKFLOW_SETTINGS_TABLE,
      { where: byWorkflow(workflow), limit: 1 }
    );
    if (existing) return false;
    await db.insert(WORKFLOW_SETTINGS_TABLE, {
      id: crypto.randomUUID(),
      workflow,
      settings: json,
      revision: 1,
      updatedBy,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  }
  const affected = await db.updateCount(
    WORKFLOW_SETTINGS_TABLE,
    {
      settings: json,
      revision: expectedRevision + 1,
      updatedBy,
      updatedAt: now,
    },
    {
      and: [
        { column: "workflow", op: "=", value: workflow },
        { column: "revision", op: "=", value: expectedRevision },
      ],
    }
  );
  return affected > 0;
}

/** The stored JSON parsed; a value this code does not understand is refused, not trusted. */
function parseStored(workflow: string, text: string): WorkflowSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: { reason: "workflow-settings-unreadable", workflow },
    });
  }
  const parsed = workflowSettingsSchema.safeParse(value);
  if (!parsed.success) {
    throw NextlyError.internal({
      logContext: {
        reason: "workflow-settings-invalid",
        workflow,
        issues: parsed.error.issues.map(issue => issue.message),
      },
    });
  }
  return parsed.data;
}
