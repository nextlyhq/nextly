import { createColors } from "picocolors";

import type { SetupPlan } from "./values";

/** @experimental */
export type PlanWarningCode =
  | "sqlite-on-vercel"
  | "local-images-on-vercel"
  | "database-has-tables";

/**
 * A combination that will break. Warnings are shown and the run goes on:
 * none of them stops it.
 *
 * @experimental
 */
export interface PlanWarning {
  code: PlanWarningCode;
  message: string;
}

/**
 * What testing the connection found, which only the test can know. Left
 * out until a connection is tested.
 *
 * @experimental
 */
export interface PlanFindings {
  /**
   * The tables the database already holds: a Nextly site's, or others.
   * Left out for an empty database.
   */
  existingTables?: "nextly" | "other";
}

/**
 * The combinations in this plan that will break, in the order the questions
 * come. They are for the review screen and the `--json` result; nothing here
 * or in `resolvePlan` refuses a plan for them.
 *
 * @experimental
 */
export function planWarnings(
  plan: SetupPlan,
  findings: PlanFindings = {}
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (plan.start === "plugin") return warnings;
  if (plan.host === "vercel" && plan.db === "sqlite") {
    warnings.push({
      code: "sqlite-on-vercel",
      message:
        "SQLite on Vercel loses data on every deploy. Pick PostgreSQL or MySQL.",
    });
  }
  if (findings.existingTables) {
    warnings.push({
      code: "database-has-tables",
      message:
        findings.existingTables === "nextly"
          ? "This database already holds a Nextly site's tables."
          : "This database already holds tables that don't look like a Nextly site.",
    });
  }
  if (plan.host === "vercel" && plan.images === "local") {
    warnings.push({
      code: "local-images-on-vercel",
      message:
        "On Vercel, images in the project folder are lost on every deploy. Pick Vercel Blob or S3.",
    });
  }
  return warnings;
}

/**
 * One warning as one line. A terminal gets it in the warning colour; output
 * that is not a terminal (a pipe, a log, an agent) gets plain text with a
 * "Warning:" label and no escape codes. `color` lets the caller turn the
 * colour off on a terminal too (picocolors' `isColorSupported` follows
 * `NO_COLOR`); the plan reads nothing from the environment itself, so the
 * same warning always formats the same way for the same options.
 *
 * @experimental
 */
export function formatPlanWarning(
  warning: PlanWarning,
  { terminal, color = terminal }: { terminal: boolean; color?: boolean }
): string {
  if (!terminal) return `Warning: ${warning.message}`;
  const colors = createColors(color);
  return colors.yellow(`▲ ${warning.message}`);
}
