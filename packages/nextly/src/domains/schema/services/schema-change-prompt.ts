// Terminal prompt for code-first schema changes using @clack/prompts.
// Shown in the next dev terminal when destructive schema changes are detected.
// Only used in development mode; non-TTY environments skip with a warning.

import * as p from "@clack/prompts";

import type { SchemaChangePromptRenderer } from "../../../cli/wrapper/change-orchestrator.js";

import type {
  FieldResolution,
  SchemaPreviewResult,
} from "./schema-change-types.js";

interface PromptResult {
  confirmed: boolean;
  resolutions: Record<string, FieldResolution>;
}

// What: class wrapper around promptSchemaChanges that satisfies the
// SchemaChangePromptRenderer contract the ChangeOrchestrator consumes.
// Why: lets the orchestrator stay testable with a mock renderer while the
// real wrapper CLI wires this @clack/prompts implementation in.
export class ClackSchemaChangePrompt implements SchemaChangePromptRenderer {
  async render(input: { slug: string; preview: SchemaPreviewResult }): Promise<{
    confirmed: boolean;
    resolutions?: Record<string, FieldResolution>;
  }> {
    const result = await promptSchemaChanges(input.slug, input.preview);
    return {
      confirmed: result.confirmed,
      resolutions: result.resolutions,
    };
  }
}

// Show the schema change confirmation prompt in the terminal.
// Returns { confirmed: true, resolutions } if user accepts,
// or { confirmed: false } if user cancels.
export async function promptSchemaChanges(
  collectionName: string,
  preview: SchemaPreviewResult
): Promise<PromptResult> {
  // Non-TTY (CI, Docker, piped output): refuse unless the caller has
  // explicitly set NEXTLY_ACCEPT_DATA_LOSS=1 (or equivalent CLI flag).
  // Matches Prisma's --accept-data-loss convention so CI pipelines that
  // knowingly want auto-apply can opt in, but default behaviour is to
  // stop rather than silently drop data.
  if (!process.stdout.isTTY) {
    const acceptDataLoss = process.env.NEXTLY_ACCEPT_DATA_LOSS === "1";
    if (acceptDataLoss) {
      console.warn(
        `\n! NEXTLY: Destructive schema changes for "${collectionName}" auto-applied via NEXTLY_ACCEPT_DATA_LOSS=1.`
      );
      if (preview.warnings.length > 0) {
        console.warn(preview.warnings.map(w => `  - ${w}`).join("\n"));
      }
      return { confirmed: true, resolutions: {} };
    }
    console.warn(
      `\n! NEXTLY: Destructive schema changes detected for "${collectionName}" but terminal is not interactive.`
    );
    console.warn(
      `  Changes NOT applied. To apply in a non-interactive context,`
    );
    console.warn(
      `  re-run with NEXTLY_ACCEPT_DATA_LOSS=1 or use an interactive terminal.\n`
    );
    return { confirmed: false, resolutions: {} };
  }

  p.intro(`Schema changes detected in "${collectionName}"`);

  // Show the diff as a formatted note
  const lines: string[] = [];
  for (const field of preview.changes.added) {
    lines.push(
      `  + ${field.name} (${field.type}${field.required ? ", required" : ", optional"})`
    );
  }
  for (const field of preview.changes.removed) {
    // Why no em dash: repo convention forbids em dashes in user-visible copy
    // because they read as AI-generated. Using a colon keeps the diff readable
    // while complying with the convention.
    const impact =
      field.rowCount > 0
        ? `: ${field.rowCount.toLocaleString()} rows have data`
        : "";
    lines.push(`  − ${field.name} (${field.type})${impact}`);
  }
  for (const field of preview.changes.changed) {
    const impact =
      field.rowCount > 0
        ? `: ${field.rowCount.toLocaleString()} rows affected`
        : "";
    lines.push(`  ~ ${field.name}: ${field.from} -> ${field.to}${impact}`);
  }

  if (lines.length > 0) {
    p.note(lines.join("\n"), "Changes");
  }

  // Show warnings
  if (preview.warnings.length > 0) {
    p.note(preview.warnings.join("\n"), "⚠ Warnings");
  }

  // Handle interactive fields first (e.g., new required field, nullable->NOT NULL)
  const resolutions: Record<string, FieldResolution> = {};
  for (const field of preview.interactiveFields) {
    const message =
      field.reason === "new_required_no_default"
        ? `Field "${field.name}" is required but table has ${field.tableRowCount.toLocaleString()} rows. No default value.`
        : `Field "${field.name}" has ${field.nullCount?.toLocaleString()} NULL values.`;

    const action = await p.select({
      message,
      options: [
        { value: "provide_default", label: "Provide a default value" },
        { value: "mark_nullable", label: "Mark as optional (nullable)" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Schema changes cancelled.");
      return { confirmed: false, resolutions: {} };
    }

    if (action === "provide_default") {
      const value = await p.text({
        message: `Enter default value for "${field.name}":`,
        validate: (v: string | undefined) => {
          if (!v || v.trim().length === 0) return "Default value is required";
        },
      });

      if (p.isCancel(value)) {
        p.cancel("Schema changes cancelled.");
        return { confirmed: false, resolutions: {} };
      }

      resolutions[field.name] = {
        action: "provide_default",
        value: String(value),
      };
    } else {
      resolutions[field.name] = {
        action: action as "mark_nullable",
      };
    }
  }

  // Final confirmation for destructive/interactive changes
  const action = await p.select({
    message: "Apply these changes?",
    options: [
      { value: "apply", label: "Yes, apply all changes" },
      { value: "cancel", label: "No, keep current schema" },
      { value: "sql", label: "Show SQL preview" },
    ],
  });

  if (p.isCancel(action) || action === "cancel") {
    p.cancel("Schema changes cancelled. Current schema preserved.");
    return { confirmed: false, resolutions };
  }

  if (action === "sql") {
    // Show DDL preview
    if (preview.ddlPreview.length > 0) {
      p.note(preview.ddlPreview.join("\n"), "SQL Preview");
    } else {
      p.note("(No DDL statements generated)", "SQL Preview");
    }

    // Ask again after showing SQL
    const confirm = await p.confirm({
      message: "Apply these changes?",
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Schema changes cancelled.");
      return { confirmed: false, resolutions };
    }
  }

  return { confirmed: true, resolutions };
}
