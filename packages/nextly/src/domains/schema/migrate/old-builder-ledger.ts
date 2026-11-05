/**
 * How the ledger's rows stand beside the old Schema Builder files of the
 * migrations folder (`old-builder-files.ts`): which rows play no part in any
 * check or listing, which files a run marks, and which marked files changed.
 *
 * An old Builder file's rows outlive the file, so the judgement is recorded
 * on the ledger while the file can be read: a mark, a record that is not an
 * outcome (`recordOldBuilderMark`). A row is then judged by its mark, never
 * by its file name:
 *
 * - a file in the folder that carries the whole signature: its rows are not
 *   an app migration's. A row naming it with no mark, or a mark of another
 *   checksum, is marked at the run's first write;
 * - a file a current mark names, gone from the folder: its rows are not an
 *   app migration's either;
 * - a file a current mark names, in the folder without the whole signature:
 *   it changed since it was recognised, and every history check refuses it;
 * - a row with no mark, or a withdrawn one, whose file is gone: a missing
 *   app migration, as any.
 *
 * `judgeOldBuilderLedger` is the judgement, pure; `readOldBuilderLedger` reads
 * the folder and the marks for it.
 *
 * @module domains/schema/migrate/old-builder-ledger
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  readMigrationFolder,
  type DeclaredNames,
} from "../../../cli/utils/migration-discovery";
import { isPluginLedgerRow } from "../events/ledger-scope";
import type {
  SchemaEventRow,
  SchemaEventsRepository,
} from "../events/schema-events-repository";

import type { OldBuilderSignaturePart } from "./old-builder-files";

/** What the judgement reads of the folder and the ledger. */
export interface OldBuilderLedgerInput {
  /** The folder's old Builder files, each with its checksum. */
  oldBuilderFiles: readonly { file: string; checksum: string }[];
  /** The folder's files with only part of the signature. */
  partialBuilderFiles: readonly {
    file: string;
    lacks: readonly OldBuilderSignaturePart[];
    checksum: string;
  }[];
  /** Every file name a ledger row of an app migration names. */
  namedByRows: ReadonlySet<string>;
  /** The newest mark of each file (`currentOldBuilderMarks`). */
  marks: ReadonlyMap<string, Pick<SchemaEventRow, "status" | "sha256">>;
}

/**
 * A marked file that no longer carries the whole signature: its content
 * changed (the mark's checksum is then its recorded checksum), or, with the
 * content as marked, a snapshot now stands beside it.
 */
export interface ChangedOldBuilderFile {
  file: string;
  change: "content" | "snapshot";
  lacks: readonly OldBuilderSignaturePart[];
}

export interface OldBuilderLedger {
  /** Files whose ledger rows are not an app migration's, for any check or listing. */
  ignoredRows: ReadonlySet<string>;
  /** Old Builder files to mark at the run's first write, with their checksums. */
  toMark: { file: string; checksum: string }[];
  changed: ChangedOldBuilderFile[];
}

/**
 * Whether a mark stands: `migrate:resolve`, accepting a changed file,
 * withdraws one by recording a newer mark as `superseded`.
 */
export function isMarkCurrent(
  mark: Pick<SchemaEventRow, "status"> | undefined
): boolean {
  return mark?.status === "applied";
}

export function judgeOldBuilderLedger(
  input: OldBuilderLedgerInput
): OldBuilderLedger {
  const inFolder = new Set([
    ...input.oldBuilderFiles.map(f => f.file),
    ...input.partialBuilderFiles.map(f => f.file),
  ]);
  const ignoredRows = new Set(input.oldBuilderFiles.map(f => f.file));
  for (const [file, mark] of input.marks) {
    if (!inFolder.has(file) && isMarkCurrent(mark)) ignoredRows.add(file);
  }
  return {
    ignoredRows,
    toMark: input.oldBuilderFiles.filter(f => owesMark(input, f)),
    changed: input.partialBuilderFiles.flatMap(f =>
      changedSinceMarked(input, f)
    ),
  };
}

/**
 * Whether an old Builder file a row names is marked now: where no mark
 * stands (none, or one withdrawn: the file carries the signature again), or
 * where the file changed within the signature.
 */
function owesMark(
  input: Pick<OldBuilderLedgerInput, "namedByRows" | "marks">,
  { file, checksum }: { file: string; checksum: string }
): boolean {
  if (!input.namedByRows.has(file)) return false;
  const mark = input.marks.get(file);
  return !isMarkCurrent(mark) || mark?.sha256 !== checksum;
}

/**
 * A partial file a current mark names, as the change since it was marked;
 * none where no mark stands. With the content as marked only the snapshot
 * can have changed the reading; any other difference is read as a change of
 * content, the stricter of the two.
 */
function changedSinceMarked(
  input: Pick<OldBuilderLedgerInput, "marks">,
  file: OldBuilderLedgerInput["partialBuilderFiles"][number]
): ChangedOldBuilderFile[] {
  const mark = input.marks.get(file.file);
  if (!isMarkCurrent(mark)) return [];
  const asMarked =
    mark?.sha256 === file.checksum && file.lacks.includes("snapshot");
  return [
    {
      file: file.file,
      change: asMarked ? "snapshot" : "content",
      lacks: file.lacks,
    },
  ];
}

/**
 * How the ledger's rows stand beside the folder's old Schema Builder files
 * (`judgeOldBuilderLedger`), from the folder, the marks and `rows`, the
 * ledger's rows.
 */
export async function readOldBuilderLedger(
  args: {
    migrationsDir: string;
    dialect: SupportedDialect;
    /** What the run's declared schema names (`readMigrationFolder`). */
    declared?: DeclaredNames;
  },
  repo: Pick<SchemaEventsRepository, "currentOldBuilderMarks">,
  rows: readonly Pick<SchemaEventRow, "filename">[]
): Promise<OldBuilderLedger> {
  const folder = await readMigrationFolder(
    args.migrationsDir,
    args.dialect,
    args.declared
  );
  return judgeOldBuilderLedger({
    oldBuilderFiles: folder.oldBuilderFiles,
    partialBuilderFiles: folder.partialBuilderFiles,
    namedByRows: new Set(
      rows.flatMap(row =>
        row.filename === null || isPluginLedgerRow(row.filename)
          ? []
          : [row.filename]
      )
    ),
    marks: await repo.currentOldBuilderMarks(),
  });
}
