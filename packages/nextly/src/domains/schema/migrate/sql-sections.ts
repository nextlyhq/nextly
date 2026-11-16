/**
 * The UP and DOWN sections of a migration file, as `nextly migrate` runs it.
 *
 * Its own module, apart from the command, so a server reading a migration
 * file (the removed-from-code state, which names the file that drops an
 * entity) splits it exactly as the command does without loading the CLI.
 *
 * @module domains/schema/migrate/sql-sections
 */

import { LOCALIZATION_INTENT_HEADER } from "../../i18n/migration/migration-intent";

/**
 * Whether a trimmed line opens a migration file's UP section: `-- UP`, and
 * the `-- UP:` and `-- UP <note>` spellings. The one test both the section
 * parser and the old-Builder-file signature read.
 */
export function isUpMarker(trimmedLine: string): boolean {
  return (
    trimmedLine === "-- UP" ||
    trimmedLine.startsWith("-- UP ") ||
    trimmedLine.startsWith("-- UP:")
  );
}

/** Whether a trimmed line opens the DOWN section, in the same spellings as `isUpMarker`. */
export function isDownMarker(trimmedLine: string): boolean {
  return (
    trimmedLine === "-- DOWN" ||
    trimmedLine.startsWith("-- DOWN ") ||
    trimmedLine.startsWith("-- DOWN:")
  );
}

export function parseSqlSections(content: string): {
  upSql: string;
  downSql: string;
} {
  const lines = content.split("\n");

  let upLines: string[] = [];
  const downLines: string[] = [];
  let currentSection: "none" | "up" | "down" = "none";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (isUpMarker(trimmedLine)) {
      currentSection = "up";
      continue;
    }
    if (isDownMarker(trimmedLine)) {
      currentSection = "down";
      continue;
    }

    if (currentSection === "up") {
      upLines.push(line);
    } else if (currentSection === "down") {
      downLines.push(line);
    }
  }

  if (upLines.length === 0 && downLines.length === 0) {
    upLines = lines.filter(
      line =>
        !line.trim().startsWith("-- Migration:") &&
        !line.trim().startsWith("-- Generated") &&
        !line.trim().startsWith("-- Dialect:") &&
        !line.trim().startsWith("-- Checksum:") &&
        !line.trim().startsWith("-- Collections:") &&
        !line.trim().startsWith("-- Singles:") &&
        // Only reached by a file with no `-- UP` marker at all. Without this the declared intent
        // would be handed to the SQL splitter as though it were a statement.
        !line.trim().startsWith(LOCALIZATION_INTENT_HEADER)
    );
  }

  return {
    upSql: upLines.join("\n").trim(),
    downSql: downLines.join("\n").trim(),
  };
}
