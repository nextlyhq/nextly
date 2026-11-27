/**
 * Tool names: the rules every served name meets, the adapter's table that
 * maps each name to its operation, and the old names a renamed tool still
 * answers to.
 *
 * A name is lower-case letters, digits and underscores, at most 64
 * characters, verb first (the action, then what it acts on). Widely used
 * model APIs refuse dots in tool names, and the directories that list agent
 * servers ask for 64 characters or fewer.
 *
 * The operation list derives each operation's name; the table here is the
 * reviewed record of which names a door may serve and which operation each
 * one runs. A served tool without a row refuses start-up, naming the tool, so
 * a new tool always arrives with a row a reviewer sees.
 *
 * @module names
 * @experimental
 */
import { NextlyError } from "nextly/errors";

import type { AgentOperation, ToolNameAlias } from "./operation";

/** The longest name a tool may have. */
export const MAX_TOOL_NAME_LENGTH = 64;

/** Lower-case words of letters and digits, joined by single underscores. */
const NAME_SHAPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The verbs a tool name may start with: the operation list's command verbs,
 * plus the ones agent tools use for reading and writing content (`find`,
 * `describe`, `upload`, `submit`, `validate`). A word outside this list in
 * first place is taken to be a noun, which breaks the verb-first rule.
 */
const TOOL_VERBS: ReadonlySet<string> = new Set([
  "abandon",
  "add",
  "audit",
  "baseline",
  "cancel",
  "check",
  "create",
  "deactivate",
  "delete",
  "describe",
  "diff",
  "down",
  "export",
  "find",
  "generate",
  "get",
  "import",
  "invite",
  "list",
  "move",
  "new",
  "orphans",
  "print",
  "prune",
  "publish",
  "pull",
  "purge",
  "redeliver",
  "reindex",
  "remove",
  "reset",
  "resolve",
  "restore",
  "retry",
  "run",
  "schedule",
  "setup",
  "snapshot",
  "status",
  "stranded",
  "submit",
  "sync",
  "test",
  "unpublish",
  "update",
  "upload",
  "validate",
]);

/**
 * What is wrong with `name` as a tool name, or `undefined` when nothing is.
 * Each answer is a sentence fragment that follows the name.
 */
export function toolNameProblem(name: string): string | undefined {
  if (name.length === 0) return "is empty";
  if (name.length > MAX_TOOL_NAME_LENGTH) {
    return `is ${name.length} characters long, more than ${MAX_TOOL_NAME_LENGTH}`;
  }
  if (!NAME_SHAPE.test(name)) {
    return "is not lower-case letters and digits joined by single underscores";
  }
  const verb = name.split("_")[0] ?? "";
  if (!TOOL_VERBS.has(verb)) {
    return `does not start with a verb (it starts with "${verb}")`;
  }
  return undefined;
}

/**
 * One row of the adapter's table: a tool name, and the ID of the operation
 * it runs, or `null` for a name decided before its operation exists. A row
 * whose operation is `null` serves nothing: the operation's own change fills
 * it in, so the map is two-way from the first release that serves the tool.
 */
export interface ToolTableRow {
  readonly name: string;
  readonly operation: string | null;
}

/**
 * The tools release one serves, and the one name reserved for a tool that
 * comes later (`get_approval_status`). No operation exists for any of them
 * yet; each row gains its operation's ID with that operation.
 */
export const TOOL_TABLE: readonly ToolTableRow[] = [
  // Site.
  { name: "get_initial_context", operation: null },
  { name: "get_approval_status", operation: null },
  // Content.
  { name: "find_entries", operation: null },
  { name: "get_entry", operation: null },
  { name: "describe_collection", operation: null },
  { name: "create_draft", operation: null },
  { name: "update_draft", operation: null },
  // Media.
  { name: "list_media", operation: null },
  { name: "upload_media", operation: null },
  // Workflow.
  { name: "get_workflow", operation: null },
  { name: "get_review_state", operation: null },
  { name: "list_waiting_for_review", operation: null },
  { name: "submit_for_review", operation: null },
  // Pages.
  { name: "list_blocks", operation: null },
  { name: "get_block_schema", operation: null },
  { name: "get_page", operation: null },
  { name: "validate_page", operation: null },
  { name: "update_page", operation: null },
  { name: "get_site_context", operation: null },
];

/** A tool's current name, and the operation behind it. */
export interface NamedOperation {
  readonly name: string;
  readonly operation: AgentOperation;
}

/** What a name a caller sent resolves to. */
export interface ResolvedName {
  readonly operation: AgentOperation;
  /** The tool's current name. */
  readonly name: string;
  /** The old name the caller used, when it was one. */
  readonly renamedFrom?: string;
  /** The release from which the old name may stop working. */
  readonly removableFrom?: string;
}

/** Both directions of the name map for one door, current names and old ones. */
export interface NameMap {
  /** Current names only, in the order the operations were given. */
  readonly served: readonly NamedOperation[];
  /** A current or old name to its operation. */
  resolve(name: string): ResolvedName | undefined;
  /** An operation's ID to its current name. */
  nameOf(operationId: string): string | undefined;
}

/** `major.minor` of a release, or `undefined` when it is not `x.y.z…`. */
function minorOf(release: string): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(release);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2])];
}

/** Whether `later` is at least one minor release after `earlier`. */
function aMinorLater(earlier: string, later: string): boolean | undefined {
  const from = minorOf(earlier);
  const to = minorOf(later);
  if (!from || !to) return undefined;
  return to[0] > from[0] || (to[0] === from[0] && to[1] > from[1]);
}

/**
 * The refusal that stops a door starting, listing every problem. Refused the
 * way core refuses an operation list with a problem, so a door never starts
 * serving a tool nobody reviewed.
 */
export function startUpRefusal(problems: readonly string[]): NextlyError {
  const count =
    problems.length === 1 ? "one problem" : `${problems.length} problems`;
  const listed = problems.map(problem => `- ${problem}`).join("\n");
  return NextlyError.invalidInput({
    message: `The MCP tool list can't be built (${count}):\n${listed}`,
    logContext: { problems: [...problems] },
  });
}

/** The table's rows by name, with a problem for each name given twice. */
function rowsByName(
  table: readonly ToolTableRow[],
  problems: string[]
): ReadonlyMap<string, ToolTableRow> {
  const rows = new Map<string, ToolTableRow>();
  for (const row of table) {
    if (rows.has(row.name))
      problems.push(`The tool table has two rows for "${row.name}"`);
    rows.set(row.name, row);
  }
  return rows;
}

/** What is wrong with a served tool's row in the table, if anything. */
function rowProblem(
  name: string,
  operation: AgentOperation,
  row: ToolTableRow | undefined
): string | undefined {
  if (!row) {
    return `The tool "${name}" (operation "${operation.id}") has no row in the adapter's tool table; add one naming its operation`;
  }
  if (row.operation === null) {
    return `The tool "${name}" is served by operation "${operation.id}", but its row in the adapter's tool table names no operation yet; set it to "${operation.id}"`;
  }
  if (row.operation !== operation.id) {
    return `The tool "${name}" is served by operation "${operation.id}", but its row in the adapter's tool table names "${row.operation}"`;
  }
  return undefined;
}

/** What is wrong with an old name of the tool `name`, if anything. */
function aliasProblems(name: string, alias: ToolNameAlias): string[] {
  const problems: string[] = [];
  const shape = toolNameProblem(alias.name);
  if (shape)
    problems.push(`The old tool name "${alias.name}" of "${name}" ${shape}`);
  const later = aMinorLater(alias.addedIn, alias.removableFrom);
  if (later === undefined) {
    problems.push(
      `The old tool name "${alias.name}" of "${name}" gives releases that are not x.y.z ("${alias.addedIn}", "${alias.removableFrom}")`
    );
  } else if (!later) {
    problems.push(
      `The old tool name "${alias.name}" of "${name}" may be removed in ${alias.removableFrom}, less than one minor release after ${alias.addedIn}`
    );
  }
  return problems;
}

/**
 * The door's two-way name map, checked against the table, with every problem
 * found, each naming the tool or operation.
 *
 * Checked: each name's shape; a row for each served tool naming that tool's
 * operation; one operation per name, current or old; and each old name kept
 * for at least one minor release.
 */
export function nameMapOf(
  served: readonly NamedOperation[],
  table: readonly ToolTableRow[]
): { readonly map: NameMap; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const rows = rowsByName(table, problems);
  const byName = new Map<string, ResolvedName>();
  const nameById = new Map<string, string>();
  const claim = (name: string, resolved: ResolvedName): void => {
    const held = byName.get(name);
    if (held) {
      problems.push(
        `The tool name "${name}" is claimed by both "${held.operation.id}" and "${resolved.operation.id}"`
      );
    } else {
      byName.set(name, resolved);
    }
  };

  for (const { name, operation } of served) {
    const shape = toolNameProblem(name);
    if (shape)
      problems.push(
        `The tool "${name}" (operation "${operation.id}") ${shape}`
      );
    const row = rowProblem(name, operation, rows.get(name));
    if (row) problems.push(row);
    claim(name, { operation, name });
    nameById.set(operation.id, name);
  }
  for (const { name, operation } of served) {
    for (const alias of operation.toolNameAliases ?? []) {
      problems.push(...aliasProblems(name, alias));
      claim(alias.name, {
        operation,
        name,
        renamedFrom: alias.name,
        removableFrom: alias.removableFrom,
      });
    }
  }

  const map: NameMap = Object.freeze({
    served: Object.freeze([...served]),
    resolve: (name: string) => byName.get(name),
    nameOf: (operationId: string) => nameById.get(operationId),
  });
  return { map, problems };
}

/**
 * The door's two-way name map, or throws (`INVALID_INPUT`) with every problem
 * {@link nameMapOf} finds.
 */
export function buildNameMap(
  served: readonly NamedOperation[],
  table: readonly ToolTableRow[]
): NameMap {
  const { map, problems } = nameMapOf(served, table);
  if (problems.length > 0) throw startUpRefusal(problems);
  return map;
}
