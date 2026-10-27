/**
 * The one consent to losing data, for every command that can delete it.
 *
 * Spelled `--accept-data-loss` on the command line and
 * `NEXTLY_ACCEPT_DATA_LOSS` in the environment. Given alone it covers every
 * deletion of the run, and the run prints each one before deleting it. Given
 * a comma-separated list (`--accept-data-loss=posts,pages.summary`) it covers
 * only those tables and columns: a named table covers every deletion in it —
 * dropping it, dropping any of its columns, removing its rows — and a named
 * `table.column` covers dropping that column. Anything it does not cover is
 * refused, named, before anything changes.
 *
 * Without consent an interactive run lists every deletion, with its count
 * when the database can be read, and asks; a run with no terminal refuses at
 * once and prints the consent that would cover it.
 *
 * The earlier spellings are honoured for what each covered before, and each
 * use is named as deprecated: `NEXTLY_ALLOW_CORE_DESTRUCTIVE` covers Nextly's
 * own tables, and the command-scoped ones (`NEXTLY_ALLOW_CODE_FIRST_DROPS`
 * for the development push and `db:sync`, `--allow-data-loss` for
 * `migrate:down`, `--force` for `prune` and `migrate:fresh`) cover that
 * command's deletions of anything but Nextly's own tables. A command says
 * which earlier spellings it honours, so one never reaches a command it did
 * not cover. `--yes` is not among them: it answers a question, and never
 * authorises deleting data.
 *
 * Pure apart from the counts, which read the database through the counting
 * helpers the schema classifier uses. Printing and asking are the caller's,
 * handed in, so the dev server's prompt and each command share one judgement.
 *
 * @module domains/schema/migrate/data-loss-consent
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { countNonEmpty, countRows } from "../pipeline/classifier/count-helpers";

/** The consent's command-line spelling. */
const ACCEPT_DATA_LOSS_FLAG = "--accept-data-loss";

/** The consent's environment spelling. */
export const ACCEPT_DATA_LOSS_ENV = "NEXTLY_ACCEPT_DATA_LOSS";

/** What `--accept-data-loss` says in every command's help. */
export const ACCEPT_DATA_LOSS_HELP =
  "Consent to deleting data. Alone it covers every deletion and lists each " +
  "one first; given tables and table.column pairs " +
  "(--accept-data-loss=posts,pages.summary) it covers only those. " +
  "Same as NEXTLY_ACCEPT_DATA_LOSS.";

/** A spelling of the consent from before there was one, honoured with a notice. */
export type EarlierSpelling =
  | "NEXTLY_ALLOW_CORE_DESTRUCTIVE"
  | "NEXTLY_ALLOW_CODE_FIRST_DROPS"
  | "--allow-data-loss"
  | "prune --force"
  | "migrate:fresh --force";

/** The earlier spellings read from the environment rather than a command's flags. */
const ENV_SPELLINGS: ReadonlySet<EarlierSpelling> = new Set([
  "NEXTLY_ALLOW_CORE_DESTRUCTIVE",
  "NEXTLY_ALLOW_CODE_FIRST_DROPS",
]);

/**
 * One thing a run would delete. `core` marks one of Nextly's own tables,
 * which only `NEXTLY_ALLOW_CORE_DESTRUCTIVE` of the earlier spellings covers.
 *
 * `count` is what the listing shows: a table's rows, a column's non-empty
 * values, and for a removal of rows its table's rows. Absent when the
 * database could not be read.
 *
 * `unnamed` is a deletion its command can judge but not yet name, such as a
 * migration's DOWN read only as "drops something": no list of targets can
 * cover what it does not name, so only consent without targets covers it.
 */
export type Deletion =
  | { kind: "table"; table: string; core?: boolean; count?: number }
  | {
      kind: "column";
      table: string;
      column: string;
      core?: boolean;
      count?: number;
    }
  | { kind: "rows"; table: string; core?: boolean; count?: number }
  | { kind: "unnamed"; description: string; core?: boolean };

/** The tables and `table.column` pairs a consent names. */
interface ConsentTargets {
  tables: ReadonlySet<string>;
  columns: ReadonlySet<string>;
}

/** The consent a run was given, resolved once from its flag and environment. */
export interface DataLossConsent {
  /**
   * The consent itself, or null when none was given. `targets` is `all` for
   * the form without targets.
   */
  given: null | {
    from: "flag" | "env";
    targets: "all" | ConsentTargets;
  };
  /** The earlier spellings the run used that its command honours. */
  earlier: readonly EarlierSpelling[];
}

/** No consent at all: what a command passes when nothing was given. */
export const NO_CONSENT: DataLossConsent = { given: null, earlier: [] };

/**
 * The tables and columns a consent's list names, or `all` for the values
 * that mean "every deletion" (`1`, `true`). The environment's `0`, `false`
 * and empty value mean no consent, as an unset variable does.
 *
 * A malformed list is refused rather than read loosely, because a misread
 * list is consent to something the operator did not name.
 */
function parseTargets(
  raw: string,
  from: "flag" | "env"
): "all" | ConsentTargets | null {
  const value = raw.trim();
  const lowered = value.toLowerCase();
  if (lowered === "1" || lowered === "true") return "all";
  if (
    from === "env" &&
    (value === "" || lowered === "0" || lowered === "false")
  )
    return null;
  const spelled =
    from === "flag"
      ? `${ACCEPT_DATA_LOSS_FLAG}=${raw}`
      : `${ACCEPT_DATA_LOSS_ENV}=${raw}`;
  const tables = new Set<string>();
  const columns = new Set<string>();
  const items = value.split(",").map(item => item.trim());
  for (const item of items) {
    const parts = item.split(".");
    const wellFormed =
      item !== "" &&
      parts.length <= 2 &&
      parts.every(part => part !== "" && !/\s/.test(part));
    if (!wellFormed) {
      throw NextlyError.invalidInput({
        message:
          `${spelled} is not a list of tables and table.column pairs: "${item}" is not one. ` +
          `Name tables and columns separated by commas (${ACCEPT_DATA_LOSS_FLAG}=posts,pages.summary), ` +
          `or give ${ACCEPT_DATA_LOSS_FLAG} alone to consent to every deletion. Nothing was changed.`,
        logContext: { consent: raw },
      });
    }
    if (parts.length === 1) tables.add(parts[0]);
    else columns.add(item);
  }
  return { tables, columns };
}

/**
 * The run's consent: the command line's when given, else the environment's.
 * A flag given replaces the variable rather than adding to it, so what the
 * operator typed for this run is what it covers.
 *
 * `flag` is what the option parser hands over for `--accept-data-loss
 * [targets]`: `true` alone, the list when one is given, `undefined` or
 * `false` when absent. `honours` names the earlier spellings this command
 * accepts; `earlierFlags` the flag-borne ones the run used, which the
 * command reads from its own options. The environment-borne ones are read
 * here, from `env`, and only when honoured.
 */
export function resolveDataLossConsent(args: {
  flag?: string | boolean;
  env?: Readonly<Record<string, string | undefined>>;
  honours?: readonly EarlierSpelling[];
  earlierFlags?: readonly EarlierSpelling[];
}): DataLossConsent {
  const env = args.env ?? {};
  const honours = args.honours ?? [];
  const usedFlags = new Set(args.earlierFlags ?? []);
  const earlier = honours.filter(spelling =>
    ENV_SPELLINGS.has(spelling)
      ? env[spelling] === "1"
      : usedFlags.has(spelling)
  );

  let given: DataLossConsent["given"] = null;
  if (args.flag === true) {
    given = { from: "flag", targets: "all" };
  } else if (typeof args.flag === "string") {
    if (args.flag.trim() === "") {
      throw NextlyError.invalidInput({
        message: `${ACCEPT_DATA_LOSS_FLAG}= names nothing. Name the tables and columns it covers (${ACCEPT_DATA_LOSS_FLAG}=posts,pages.summary), or give ${ACCEPT_DATA_LOSS_FLAG} alone. Nothing was changed.`,
      });
    }
    const targets = parseTargets(args.flag, "flag");
    if (targets !== null) given = { from: "flag", targets };
  } else {
    const raw = env[ACCEPT_DATA_LOSS_ENV];
    const targets = raw === undefined ? null : parseTargets(raw, "env");
    if (targets !== null) given = { from: "env", targets };
  }
  return { given, earlier };
}

/** The deprecation notice for each earlier spelling the run used. */
export function deprecationNotices(consent: DataLossConsent): string[] {
  return consent.earlier.map(spelling => {
    const replacement = ENV_SPELLINGS.has(spelling)
      ? `${ACCEPT_DATA_LOSS_ENV} (or ${ACCEPT_DATA_LOSS_FLAG})`
      : ACCEPT_DATA_LOSS_FLAG;
    const named = spelling.endsWith("--force")
      ? `${spelling.replace(" --force", "")}'s --force`
      : spelling;
    return (
      `${named} is deprecated and will be removed: use ${replacement}, ` +
      `which can name the tables and columns it covers.`
    );
  });
}

/** A key that names one deletion, for telling two listings' entries apart. */
function deletionKey(deletion: Deletion): string {
  switch (deletion.kind) {
    case "table":
      return `table:${deletion.table}`;
    case "column":
      return `column:${deletion.table}.${deletion.column}`;
    case "rows":
      return `rows:${deletion.table}`;
    case "unnamed":
      return `unnamed:${deletion.description}`;
  }
}

/**
 * Whether the consent covers one deletion: an earlier spelling for what it
 * covered before, the consent without targets for everything, and a list for
 * the deletions in a table it names or of a column it names.
 */
export function consentCovers(
  consent: DataLossConsent,
  deletion: Deletion
): boolean {
  const core = deletion.core === true;
  for (const spelling of consent.earlier) {
    if ((spelling === "NEXTLY_ALLOW_CORE_DESTRUCTIVE") === core) return true;
  }
  const given = consent.given;
  if (given === null) return false;
  if (given.targets === "all") return true;
  if (deletion.kind === "unnamed") return false;
  if (given.targets.tables.has(deletion.table)) return true;
  return (
    deletion.kind === "column" &&
    given.targets.columns.has(`${deletion.table}.${deletion.column}`)
  );
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** One line of a listing: what is deleted, and how much of it when counted. */
export function describeDeletion(deletion: Deletion): string {
  switch (deletion.kind) {
    case "table":
      return deletion.count === undefined
        ? `table ${deletion.table}`
        : `table ${deletion.table} (${plural(deletion.count, "row", "rows")})`;
    case "column":
      return deletion.count === undefined
        ? `column ${deletion.table}.${deletion.column}`
        : `column ${deletion.table}.${deletion.column} (${plural(deletion.count, "non-empty value", "non-empty values")})`;
    case "rows":
      return deletion.count === undefined
        ? `rows of ${deletion.table}`
        : `rows of ${deletion.table} (the table has ${plural(deletion.count, "row", "rows")})`;
    case "unnamed":
      return deletion.description;
  }
}

/**
 * The consent that covers `deletions` as well as what the given consent
 * already named: a list when every deletion is named, the form without
 * targets when one is not. Both spellings, or only the variable where the
 * command takes no flag (a development server's push).
 */
function consentHint(
  deletions: readonly Deletion[],
  consent: DataLossConsent,
  flag: boolean
): string {
  const blanket = deletions.some(d => d.kind === "unnamed");
  const forms = (value: string | null): string => {
    const env =
      value === null
        ? `${ACCEPT_DATA_LOSS_ENV}=1`
        : `${ACCEPT_DATA_LOSS_ENV}=${value}`;
    if (!flag) return env;
    const cli =
      value === null
        ? ACCEPT_DATA_LOSS_FLAG
        : `${ACCEPT_DATA_LOSS_FLAG}=${value}`;
    return `${cli} (or ${env})`;
  };
  if (blanket) return forms(null);
  const named = consent.given?.targets;
  const tables = new Set(
    named === undefined || named === "all" ? [] : named.tables
  );
  const columns = new Set(
    named === undefined || named === "all" ? [] : named.columns
  );
  for (const d of deletions) {
    if (d.kind === "column") columns.add(`${d.table}.${d.column}`);
    else if (d.kind !== "unnamed") tables.add(d.table);
  }
  const tokens = [
    ...tables,
    ...[...columns].filter(column => !tables.has(column.split(".")[0])),
  ];
  return forms(tokens.join(","));
}

/** What `judgeDataLoss` decided. */
export type DataLossVerdict =
  | { kind: "proceed" }
  | { kind: "declined" }
  | {
      kind: "refused";
      /**
       * `not-covered`: a consent naming targets was given and leaves some
       * deletion out. `needs-consent`: none covers it, and no terminal is
       * there to ask.
       */
      reason: "not-covered" | "needs-consent";
      /** The refusal, naming each deletion left out and the consent that covers it. */
      message: string;
      uncovered: Deletion[];
    };

/**
 * Whether a run may delete `deletions`, decided before anything changes.
 *
 * - Nothing to delete: proceed.
 * - Every deletion covered: print each one, then proceed.
 * - A consent naming targets that leaves one out: refuse, naming it, even
 *   with a terminal: the operator said what may go, and this is not on it.
 * - Otherwise, with a terminal: list every deletion and ask.
 * - Otherwise: refuse at once, without waiting for input.
 *
 * `approved` holds deletions the operator already agreed to in this run (a
 * command that decides twice, before and under its lock, asks only once).
 * `flag` says whether the command takes `--accept-data-loss`, so the hint
 * names only a spelling that reaches it.
 */
export async function judgeDataLoss(args: {
  deletions: readonly Deletion[];
  consent: DataLossConsent;
  interactive: boolean;
  ask: (question: string) => Promise<boolean>;
  print: (line: string) => void;
  flag?: boolean;
  approved?: readonly Deletion[];
}): Promise<DataLossVerdict> {
  const { deletions, consent } = args;
  if (deletions.length === 0) return { kind: "proceed" };
  const approved = new Set((args.approved ?? []).map(deletionKey));
  const uncovered = deletions.filter(
    d => !consentCovers(consent, d) && !approved.has(deletionKey(d))
  );
  const lines = (list: readonly Deletion[]) =>
    list.map(d => `  - ${describeDeletion(d)}`);

  if (uncovered.length === 0) {
    args.print(
      `Deleting ${plural(deletions.length, "item", "items")}, with consent:`
    );
    for (const line of lines(deletions)) args.print(line);
    return { kind: "proceed" };
  }

  const flag = args.flag ?? true;
  const targets = consent.given?.targets;
  if (targets !== undefined && targets !== "all") {
    const unnamedNote = uncovered.some(d => d.kind === "unnamed")
      ? " A deletion its command cannot name is covered only by the consent without targets."
      : "";
    return {
      kind: "refused",
      reason: "not-covered",
      uncovered,
      message:
        `The consent given does not cover ${plural(uncovered.length, "deletion", "deletions")}:\n` +
        `${lines(uncovered).join("\n")}\n` +
        `Nothing was changed.${unnamedNote} To delete this too: ${consentHint(uncovered, consent, flag)}.`,
    };
  }

  if (args.interactive) {
    args.print(
      `This deletes ${plural(deletions.length, "item", "items")}, which cannot be undone:`
    );
    for (const line of lines(deletions)) args.print(line);
    return (await args.ask("Delete this data?"))
      ? { kind: "proceed" }
      : { kind: "declined" };
  }

  return {
    kind: "refused",
    reason: "needs-consent",
    uncovered,
    message:
      `Deleting data needs consent, and no terminal is attached to ask. This would delete:\n` +
      `${lines(uncovered).join("\n")}\n` +
      `Nothing was changed. To consent: ${consentHint(uncovered, consent, flag)}.`,
  };
}

/**
 * `deletions` with their counts read from the database: a table's rows, a
 * column's non-empty values, and for a removal of rows its table's rows. A
 * count already given is kept, and one that cannot be read is left out
 * rather than failing the run: the listing is still asked about, without it.
 */
export async function countDeletions(
  deletions: readonly Deletion[],
  db: unknown,
  dialect: SupportedDialect
): Promise<Deletion[]> {
  const counted: Deletion[] = [];
  for (const deletion of deletions) {
    if (deletion.kind === "unnamed" || deletion.count !== undefined) {
      counted.push(deletion);
      continue;
    }
    try {
      const count =
        deletion.kind === "column"
          ? await countNonEmpty(db, dialect, deletion.table, deletion.column)
          : await countRows(db, dialect, deletion.table);
      counted.push({ ...deletion, count });
    } catch {
      counted.push(deletion);
    }
  }
  return counted;
}

/** Whether a person is there to answer: a terminal on both ends. */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
