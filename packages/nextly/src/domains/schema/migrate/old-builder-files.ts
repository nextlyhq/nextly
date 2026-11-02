// STUB: replaced once the tests are seen failing.
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

export type OldBuilderSignaturePart = "snapshot" | "header" | "scope";

export type MigrationFileKind =
  | { kind: "old-builder"; entity: string }
  | { kind: "partial"; lacks: OldBuilderSignaturePart[] }
  | { kind: "ordinary" };

export interface MigrationFileFacts {
  name: string;
  content: string;
  hasSnapshot: boolean;
  dialect: SupportedDialect;
}

export function classifyMigrationFile(
  _file: MigrationFileFacts
): MigrationFileKind {
  return { kind: "ordinary" };
}
