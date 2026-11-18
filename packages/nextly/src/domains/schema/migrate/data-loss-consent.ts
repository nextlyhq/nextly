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
 * not cover. Once the consent itself is given, it alone decides: an earlier
 * spelling still set beside it is named ignored, so a list cannot be widened
 * by a variable left over from before. `--yes` is not among them: it answers a
 * question, and never authorises deleting data.
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

/** The consent's command-line spelling, which a command naming the consent that would cover a change reads. */
export const ACCEPT_DATA_LOSS_FLAG = "--accept-data-loss";

/** The consent's environment spelling. */
export const ACCEPT_DATA_LOSS_ENV = "NEXTLY_ACCEPT_DATA_LOSS";

// What `--accept-data-loss` says in every command's help, defined in a module
// that imports nothing so declaring a command does not load these checks.
export { ACCEPT_DATA_LOSS_HELP } from "./data-loss-consent-help";

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
 * `alongside` names what goes with a table that lives elsewhere, such as an
 * entity's archived translations in a table every entity shares: it is the
 * table's data, listed with it and covered by naming it, since naming the
 * shared table would cover every other entity's too.
 *
 * `unnamed` is a deletion its command can judge but not yet name, such as a
 * migration's DOWN read only as "drops something": no list of targets can
 * cover what it does not name, so only consent without targets covers it.
 * Its `fingerprint` names the statements it was judged from, so agreeing to it
 * does not agree to different statements under the same description.
 *
 * `reason` says why it goes, where the command knows (`no longer in the
 * config`, `rename to excerpt declined`), so the person asked can tell a
 * deletion they meant from one they did not.
 *
 * `owner` is the main table of the collection or Single the deletion belongs
 * to, the one its registry row names, where it is not that table itself: a
 * deletion in another table the entity owns (its translation table, its
 * junction tables), or the entity's rows in a table every entity shares. A
 * consent naming the owner covers it, as naming its own table does
 * (`entity-coverage.ts`). A `rows` deletion with `of` is only that entity's
 * rows in a shared table, and its `count` is theirs, never the table's.
 */
export type Deletion =
  | {
      kind: "table";
      table: string;
      core?: boolean;
      count?: number;
      alongside?: string;
      reason?: string;
      owner?: string;
    }
  | {
      kind: "column";
      table: string;
      column: string;
      core?: boolean;
      count?: number;
      reason?: string;
      owner?: string;
    }
  | {
      kind: "rows";
      table: string;
      core?: boolean;
      count?: number;
      reason?: string;
      owner?: string;
      of?: EntityRef;
    }
  | {
      kind: "unnamed";
      description: string;
      core?: boolean;
      fingerprint?: string;
    };

/** A collection or a Single, as the listing names whose rows go from a shared table. */
export interface EntityRef {
  kind: "collection" | "single";
  slug: string;
}

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
  /**
   * The earlier spellings the run used that its command honours, and that
   * still count: none once the consent itself is given.
   */
  earlier: readonly EarlierSpelling[];
  /** Earlier spellings the run used that the consent given replaced. */
  ignored: readonly EarlierSpelling[];
}

/** No consent at all: what a command passes when nothing was given. */
export const NO_CONSENT: DataLossConsent = {
  given: null,
  earlier: [],
  ignored: [],
};

/** The values the consent reads as a yes to every deletion, in lower case. */
const YES: ReadonlySet<string> = new Set(["1", "true"]);

/** The values the variable reads as no consent, in lower case. */
const NO: ReadonlySet<string> = new Set(["0", "false"]);

/**
 * Whether the consent reads `table`, given as its only target, as a yes or a
 * no and not as a table's name: named so, a table cannot be asked for by
 * name, since `=false` gives no consent and `=true` consents to everything.
 */
function readAsYesOrNo(table: string): boolean {
  const lowered = table.toLowerCase();
  return YES.has(lowered) || NO.has(lowered);
}

/**
 * Whether a list of targets can spell `name`, a table's or a column's: the
 * list is cut at commas and each target at its dot, and whitespace is taken
 * for a mistyped list, so a name holding any of them cannot be given. The one
 * rule for reading a list and for naming a deletion in one.
 */
function spellable(name: string): boolean {
  return name !== "" && !/[\s,.]/.test(name);
}

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
  if (YES.has(lowered)) return "all";
  if (from === "env" && (value === "" || NO.has(lowered))) return null;
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
      item !== "" && parts.length <= 2 && parts.every(spellable);
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
  const used = honours.filter(spelling =>
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
  // The consent given replaces the earlier spellings rather than adding to
  // them: what it names is all the run may delete.
  return given === null
    ? { given, earlier: used, ignored: [] }
    : { given, earlier: [], ignored: used };
}

/**
 * The notice for each earlier spelling the run used: deprecated where it
 * still counted, ignored where the consent given replaced it.
 */
export function deprecationNotices(consent: DataLossConsent): string[] {
  const replacedBy =
    consent.given?.from === "flag"
      ? ACCEPT_DATA_LOSS_FLAG
      : ACCEPT_DATA_LOSS_ENV;
  const ignored = consent.ignored.map(
    spelling =>
      `${spelling} is ignored: ${replacedBy} was given, and it alone decides what this run may delete.`
  );
  return [
    ...ignored,
    ...consent.earlier.map(spelling => {
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
    }),
  ];
}

/**
 * A key that names one deletion, for telling two listings' entries apart. The
 * owner is part of it, so an entity's rows in a shared table never share a key
 * with a removal of that table's rows, and a deletion agreed to as one
 * entity's is not taken for one that belongs to nobody.
 */
export function deletionKey(deletion: Deletion): string {
  if (deletion.kind === "unnamed") {
    return `unnamed:${deletion.description}:${deletion.fingerprint ?? ""}`;
  }
  const owned = deletion.owner === undefined ? "" : `@${deletion.owner}`;
  switch (deletion.kind) {
    case "table":
      return `table:${deletion.table}${owned}`;
    case "column":
      return `column:${deletion.table}.${deletion.column}${owned}`;
    case "rows":
      return `rows:${deletion.table}${owned}`;
  }
}

/**
 * Whether only the consent without targets covers `deletion`: one its
 * command cannot name, one whose table or column a list of targets cannot
 * spell ({@link spellable}): a schema-qualified table, which a list cannot
 * tell from a `table.column`, among them; or one on a table whose name the
 * consent reads as a yes or a no ({@link readAsYesOrNo}). A refusal then asks for the consent
 * without targets, never for a list the consent would refuse to read.
 */
function onlyBlanketCovers(deletion: Deletion): boolean {
  if (deletion.kind === "unnamed") return true;
  // An entity's rows in a shared table are named by its main table alone, not
  // by the shared table, which may be no table's name (the field groups').
  const owner = sharedRowsOwner(deletion);
  if (owner !== undefined) return !nameableTable(owner);
  if (!nameableTable(deletion.table)) return true;
  return deletion.kind === "column" && !spellable(deletion.column);
}

/** Whether a list of targets can name `table` as a table: spelled, and not read as a yes or a no. */
function nameableTable(table: string): boolean {
  return spellable(table) && !readAsYesOrNo(table);
}

/**
 * Whether the consent covers one deletion: an earlier spelling for what it
 * covered before, the consent without targets for everything, and a list for
 * the deletions in a table it names or of a column it names. Naming an
 * entity's main table also covers every deletion that table owns (`owner`):
 * the entity's other tables and its rows in shared tables, and nothing else.
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
  if (deletion.kind === "unnamed" || onlyBlanketCovers(deletion)) return false;
  if (given.targets.tables.has(deletion.table)) return true;
  if (deletion.owner !== undefined && given.targets.tables.has(deletion.owner))
    return true;
  return (
    deletion.kind === "column" &&
    given.targets.columns.has(`${deletion.table}.${deletion.column}`)
  );
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * One line of a listing: what is deleted, how much of it when counted, and
 * why it goes when the command said.
 */
export function describeDeletion(deletion: Deletion): string {
  const what = describeWhat(deletion);
  return deletion.kind === "unnamed" || deletion.reason === undefined
    ? what
    : `${what}: ${deletion.reason}`;
}

/** What is deleted, and how much of it when counted. */
function describeWhat(deletion: Deletion): string {
  switch (deletion.kind) {
    case "table": {
      const counted =
        deletion.count === undefined
          ? `table ${deletion.table}`
          : `table ${deletion.table} (${plural(deletion.count, "row", "rows")})`;
      const alongside =
        deletion.alongside === undefined
          ? counted
          : `${counted}, with ${deletion.alongside}`;
      return belonging(alongside, deletion.owner);
    }
    case "column":
      return belonging(
        deletion.count === undefined
          ? `column ${deletion.table}.${deletion.column}`
          : `column ${deletion.table}.${deletion.column} (${plural(deletion.count, "non-empty value", "non-empty values")})`,
        deletion.owner
      );
    case "rows": {
      if (deletion.of !== undefined) {
        const whose = `rows of ${entityLabel(deletion.of)} in ${deletion.table}`;
        return deletion.count === undefined
          ? whose
          : `${whose} (${plural(deletion.count, "row", "rows")})`;
      }
      return belonging(
        deletion.count === undefined
          ? `rows of ${deletion.table}`
          : `rows of ${deletion.table} (the table has ${plural(deletion.count, "row", "rows")})`,
        deletion.owner
      );
    }
    case "unnamed":
      return deletion.description;
  }
}

/** A collection or Single as a listing names it: `collection "posts"`, `Single "home"`. */
function entityLabel(entity: EntityRef): string {
  return `${entity.kind === "single" ? "Single" : "collection"} "${entity.slug}"`;
}

/** `what`, saying which entity's main table it belongs to, where it belongs to one. */
function belonging(what: string, owner: string | undefined): string {
  return owner === undefined ? what : `${what}, belonging to ${owner}`;
}

/** The consent in both spellings, as a command's refusal ends on it. */
const commandForms = (cli: string, env: string): string => `${cli} (or ${env})`;

/**
 * {@link commandForms} as it stands in a refusal's message. The two spellings
 * carry one value, so the variable's is matched as the flag's again: a target
 * may hold any character a table or column name can, a space or a closing
 * parenthesis among them, and is never cut short at one. The form without
 * targets has no value on the flag and `1` on the variable.
 */
const COMMAND_FORMS = new RegExp(
  `${ACCEPT_DATA_LOSS_FLAG}(?:=(.+?))? \\(or ${ACCEPT_DATA_LOSS_ENV}=(?:\\1|1)\\)`
);

/**
 * A refusal's message (`judgeDataLoss`) for a production start that ran the
 * migrations itself. A start takes no flag, so the consent the message ends
 * on reads as a start is given it, the variable, then as `nextly migrate`
 * takes it. A message naming no such consent is returned as it is.
 */
export function refusalForStart(message: string): string {
  return message.replace(COMMAND_FORMS, (_forms, value?: string) =>
    value === undefined
      ? `start with ${ACCEPT_DATA_LOSS_ENV}=1, or run "nextly migrate ${ACCEPT_DATA_LOSS_FLAG}"`
      : `start with ${ACCEPT_DATA_LOSS_ENV}=${value}, or run "nextly migrate ${ACCEPT_DATA_LOSS_FLAG}=${value}"`
  );
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
  if (deletions.some(onlyBlanketCovers)) return consentForms(null, flag);
  return consentForms(consentTokens(deletions, consent).join(","), flag);
}

/**
 * A consent value as the variable spells it, and as the flag does too where
 * the command takes one; `null` is the form without targets.
 */
function consentForms(value: string | null, flag: boolean): string {
  const env = `${ACCEPT_DATA_LOSS_ENV}=${value ?? "1"}`;
  if (!flag) return env;
  const cli =
    value === null
      ? ACCEPT_DATA_LOSS_FLAG
      : `${ACCEPT_DATA_LOSS_FLAG}=${value}`;
  return commandForms(cli, env);
}

/** Tables and `table.column` pairs, as a list of targets names them. */
interface TargetNames {
  tables: Set<string>;
  columns: Set<string>;
}

/** A deletion a consent can name by its table. */
type NamedDeletion = Exclude<Deletion, { kind: "unnamed" }>;

/**
 * The targets a consent covering every one of `deletions` names: those the
 * given consent names already, then what names each deletion besides, tables
 * first, then each column whose table is not named. Each rule is its own step
 * below, so each can be read, and tested, alone.
 */
function consentTokens(
  deletions: readonly Deletion[],
  consent: DataLossConsent
): string[] {
  const names = givenNames(consent);
  const named = deletions.filter(isNamedDeletion);
  // What names itself goes first, so an entity's other deletions can see
  // whether their owner is named already, by the run or by the consent.
  for (const deletion of named) nameUnowned(deletion, names);
  for (const deletion of named) nameOwned(deletion, names);
  return listNames(names);
}

/** The tables and columns the given consent names; none for no consent or the form without targets. */
function givenNames(consent: DataLossConsent): TargetNames {
  const targets = consent.given?.targets;
  const list = typeof targets === "object" ? targets : undefined;
  return { tables: new Set(list?.tables), columns: new Set(list?.columns) };
}

/** Whether a list of targets can name `deletion` at all: every deletion but one its command cannot name. */
function isNamedDeletion(deletion: Deletion): deletion is NamedDeletion {
  return deletion.kind !== "unnamed";
}

/**
 * Names a deletion that names itself: an entity's rows in a shared table by
 * the entity's main table, since naming the shared table would agree to every
 * other entity's rows there, and a deletion no entity owns by its own table.
 */
function nameUnowned(deletion: NamedDeletion, names: TargetNames): void {
  const owner = sharedRowsOwner(deletion);
  if (owner !== undefined) names.tables.add(owner);
  else if (deletion.owner === undefined) nameByOwnTable(deletion, names);
}

/**
 * Names an entity's other deletion by its own table, the narrowest consent,
 * unless its owner is named already, which covers it. The entity's rows in a
 * shared table always find it named: naming them named it.
 */
function nameOwned(deletion: NamedDeletion, names: TargetNames): void {
  if (deletion.owner === undefined || names.tables.has(deletion.owner)) return;
  nameByOwnTable(deletion, names);
}

/** Every table named, then each column whose table is not, as the consent lists them. */
function listNames(names: TargetNames): string[] {
  const columns = [...names.columns].filter(
    column => !names.tables.has(column.split(".")[0])
  );
  return [...names.tables, ...columns];
}

/**
 * The main table of the entity whose rows in a shared table `deletion` is,
 * or `undefined` when it is not one entity's rows there. Only that table
 * names such a deletion.
 */
function sharedRowsOwner(deletion: Deletion): string | undefined {
  return deletion.kind === "rows" && deletion.of !== undefined
    ? deletion.owner
    : undefined;
}

/** Names `deletion` by its own table: a column as `table.column`, anything else as its table. */
function nameByOwnTable(deletion: NamedDeletion, names: TargetNames): void {
  if (deletion.kind === "column") {
    names.columns.add(`${deletion.table}.${deletion.column}`);
  } else {
    names.tables.add(deletion.table);
  }
}

/**
 * The consent a command taking `--accept-data-loss` needs to delete
 * `deletions` when none is given: what a dry run names, so the operator
 * learns the exact value before a real run refuses.
 */
export function consentToCover(deletions: readonly Deletion[]): string {
  return consentHint(deletions, NO_CONSENT, true);
}

/** What `judgeDataLoss` decided. */
export type DataLossVerdict =
  | { kind: "proceed" }
  | { kind: "declined" }
  | {
      kind: "refused";
      /**
       * `not-covered`: a consent naming targets was given and leaves some
       * deletion out. `needs-consent`: none covers it, and nobody can be
       * asked (no terminal, `CI` set, or `--non-interactive`).
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
 * names only a spelling that reaches it. `sourceOf` names the file a
 * deletion comes from, so one listing, and one question, can cover a run of
 * several files: each file is named above what it deletes.
 */
export async function judgeDataLoss(args: {
  deletions: readonly Deletion[];
  consent: DataLossConsent;
  interactive: boolean;
  ask: (question: string) => Promise<boolean>;
  print: (line: string) => void;
  flag?: boolean;
  approved?: readonly Deletion[];
  sourceOf?: (deletion: Deletion) => string | undefined;
}): Promise<DataLossVerdict> {
  const { deletions, consent } = args;
  if (deletions.length === 0) return { kind: "proceed" };
  const approved = new Set((args.approved ?? []).map(deletionKey));
  // Agreeing to drop an entity's main table agrees to what that table owns,
  // as a consent naming it covers it: the entity's other tables and its rows
  // in shared tables.
  const isApproved = (d: Deletion) =>
    approved.has(deletionKey(d)) ||
    (d.kind !== "unnamed" &&
      d.owner !== undefined &&
      approved.has(deletionKey({ kind: "table", table: d.owner })));
  const uncovered = deletions.filter(
    d => !consentCovers(consent, d) && !isApproved(d)
  );
  const lines = (list: readonly Deletion[]) => {
    const out: string[] = [];
    let heading: string | undefined;
    for (const d of list) {
      const source = args.sourceOf?.(d);
      if (source === undefined) {
        heading = undefined;
        out.push(`  - ${describeDeletion(d)}`);
        continue;
      }
      if (source !== heading) out.push(`  ${source}:`);
      heading = source;
      out.push(`    - ${describeDeletion(d)}`);
    }
    return out;
  };

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
    const unnamedNote = uncovered.some(onlyBlanketCovers)
      ? " A deletion its command cannot name, one on a schema-qualified table, or one whose table or column name holds a space, a comma or a dot, or whose table is named 1, true, 0 or false, is covered only by the consent without targets."
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
      `Deleting data needs consent, and nobody can be asked (no terminal, CI, or --non-interactive). This would delete:\n` +
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
    // An entity's rows in a shared table are counted by what reads them
    // (`entity-shared-rows.ts`): the table's count would overstate them.
    if (
      deletion.kind === "unnamed" ||
      deletion.count !== undefined ||
      (deletion.kind === "rows" && deletion.of !== undefined)
    ) {
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
