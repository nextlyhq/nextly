// A `nextly repair-columns` run without `--apply`: read the database, report every column whose type
// or nullability differs from its field, and change nothing.
//
// It never takes the schema lock, since taking it writes a claim. It reads who holds it instead,
// and when another schema change does, it still reports and says the report may change once that
// change ends.
//
// @module domains/schema/repair-columns/run-report

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { describeHolder, readSchemaLockHolder } from "../pipeline/schema-lock";
import type { SupportedDialect } from "../services/field-column-descriptor";

import { findColumnDifferences } from "./find-differences";
import { NO_RUN_FACTS } from "./outcome";
import {
  formatRecord,
  formatSummary,
  formatTableLock,
  repairRecord,
  tableLocks,
} from "./report";
import {
  reportDocument,
  SCHEMA_LOCK_HELD_WARNING,
  type DocumentProblem,
  type RepairColumnsDocument,
} from "./report-json";
import type { RepairEntity } from "./types";

/** The warning a report made while another schema change held the lock carries. */
function schemaLockWarning(holder: string): DocumentProblem {
  return {
    code: SCHEMA_LOCK_HELD_WARNING,
    message:
      "Another schema change is running, so this report may change once it ends.",
    cause: holder,
    next: "Run `nextly repair-columns` again once that change ends.",
    docs: null,
  };
}

/** The document of a dry run over `entities`. Reads the database and changes nothing. */
export async function dryRunReport(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  entities: readonly RepairEntity[];
  nextlyVersion: string;
}): Promise<RepairColumnsDocument> {
  const { adapter, dialect } = args;
  const holder = await readSchemaLockHolder(adapter);
  const findings = await findColumnDifferences({
    db: adapter.getDrizzle(),
    dialect,
    entities: args.entities,
  });
  const described = holder === null ? null : describeHolder(holder);
  return reportDocument({
    nextlyVersion: args.nextlyVersion,
    mode: "dry-run",
    dialect,
    schemaLock: { held: described !== null, holder: described },
    records: findings.map(finding =>
      repairRecord(finding, NO_RUN_FACTS, "dry-run")
    ),
    warnings: described === null ? [] : [schemaLockWarning(described)],
  });
}

/** One printed block of the text report, and whether it is a finding that needs attention. */
export interface ReportLine {
  text: string;
  level: "info" | "warn" | "success";
}

/**
 * The text report of a run's document: what was compared, a running schema change, each column,
 * each table the run could not get, then the count of each outcome. It says what the document
 * says, from the same records.
 */
export function formatReport(document: RepairColumnsDocument): ReportLine[] {
  const result = document.result;
  if (result === null) return [];
  const lines: ReportLine[] = [
    {
      level: "info",
      text:
        result.mode === "dry-run"
          ? "Each column Nextly builds from field definitions, compared with its field as last migrated. Nothing is changed."
          : "Each column Nextly builds from field definitions, compared with its field as last migrated, and converted where it is safe.",
    },
  ];
  for (const warning of document.warnings) {
    const cause = warning.cause === null ? "" : ` ${warning.cause}`;
    lines.push({ level: "warn", text: `${warning.message}${cause}` });
  }
  for (const record of result.records) {
    lines.push({ level: "warn", text: formatRecord(record) });
  }
  const locks = tableLocks(result.records);
  if (locks.length > 0) {
    lines.push({
      level: "warn",
      text: [
        "Tables the run could not get:",
        ...locks.map(lock => `  ${formatTableLock(lock)}`),
      ].join("\n"),
    });
  }
  lines.push(
    result.records.length === 0
      ? { level: "success", text: "Every column matches its field." }
      : { level: "info", text: formatSummary(result.summary.outcomes) }
  );
  return lines;
}
