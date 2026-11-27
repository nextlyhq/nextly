/**
 * The checks the operation list must pass before Nextly starts: every
 * declaration complete and consistent with itself, and no two operations
 * claiming one ID or one set of command words. Each problem names the
 * operation and where it came from, so whoever reads the refusal knows which
 * file or plugin to change.
 *
 * Runtime checks repeat what the types already require because a plugin's
 * declaration can come from plain JavaScript, which no type checker read.
 *
 * @module operations/start-up-checks
 * @experimental
 */
import { SLUG_PATTERN } from "../shared/slug-pattern";

import {
  DOORS,
  RISK_LEVELS,
  SHARED_EXIT_CODES,
  type OperationDefinition,
  type OperationEffects,
  type OperationExitCode,
  type RiskLevel,
  type OperationSource,
} from "./definition";
import { levelRank } from "./levels";

/** One contributor's operations: core's, or one plugin's. */
export interface OperationContribution {
  readonly source: OperationSource;
  readonly operations: readonly OperationDefinition[];
}

/** `<noun>.<verb>`, or one word for a top-level verb; lower case, hyphens inside a word. */
const ID_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;

/** One command word: lower case, hyphens inside a word. */
const WORD_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * One word of an old name, which may also hold the colons today's commands
 * were named with (`migrate:status`, `db:sync`), so those names keep working.
 */
const OLD_WORD_PATTERN = /^[a-z][a-z0-9]*(?:[-:][a-z0-9]+)*$/;

/** The doors on which an operation that needs no permission may run. */
const DOORS_WITHOUT_PERMISSION: Readonly<
  Record<"project" | "maintenance", readonly string[]>
> = {
  // Only the person's own project folder holds the files it changes.
  project: ["local"],
  // Schema upkeep runs where the person owns the database, or in a deploy.
  maintenance: ["local", "deploy"],
};

/**
 * The only operations that may run on the deploy door, where the CLI acts as
 * the deployment against a live database: those that bring its schema up to
 * the code, or check that it is. A deploy pipeline may run nothing else.
 */
export const DEPLOY_DOOR_OPERATIONS: ReadonlySet<string> = new Set([
  "migrate",
  "migrations.status",
  "migrations.check",
  "doctor",
]);

/** The longest permission name the permissions table stores. */
const MAX_PERMISSION_NAME_LENGTH = 100;

/** The effects every declaration states, each a yes or a no. */
const EFFECTS = ["destroys", "idempotent", "outside", "spendsAi"] as const;

/** One rule a declaration must keep, answering the clauses it breaks. */
type DefinitionCheck = (
  op: OperationDefinition,
  contributor: OperationSource
) => string[];

/** How a refusal names where an operation came from. */
function describeSource(source: OperationSource): string {
  return source.kind === "core" ? "core" : `plugin "${source.name}"`;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * `value` as a refusal quotes it. Never throws: a value JSON can't write (a
 * bigint, a circular object) is described instead.
 */
function quoted(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * Whether an "Always allow" mark is one the list reads as declared: left out,
 * or `false`. Anything else (`"false"`, `true`) would be read as allowing it,
 * which is not what a declarer who wrote it meant to say.
 */
function isAbsentOrFalse(value: unknown): boolean {
  return value === undefined || value === false;
}

/**
 * Whether `name` is spelled as a stored permission: an action, a hyphen,
 * then the slug it acts on, in the one shape a slug takes, no longer than the
 * column that stores it. A spelling such as `posts:read` matches no stored
 * permission, so an operation declaring it could never be allowed.
 */
function isStoredPermission(name: string): boolean {
  return (
    SLUG_PATTERN.test(name) &&
    name.indexOf("-") > 0 &&
    !name.endsWith("-") &&
    name.length <= MAX_PERMISSION_NAME_LENGTH
  );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whether `op` declares any rule that raises its level. */
function raises(op: OperationDefinition): boolean {
  return Array.isArray(op.raise) && op.raise.some(isObject);
}

/** Core, or a plugin with a name: nothing else may register an operation. */
function isSource(value: unknown): value is OperationSource {
  if (!isObject(value) || !("kind" in value)) return false;
  if (value.kind === "core") return true;
  return (
    value.kind === "plugin" && "name" in value && isNonEmptyText(value.name)
  );
}

function sameSource(a: OperationSource, b: OperationSource): boolean {
  if (a.kind === "core" || b.kind === "core") return a.kind === b.kind;
  return a.name === b.name;
}

/** Whether `words` is a non-empty list of words that `pattern` accepts. */
function areWords(words: unknown, pattern: RegExp): words is string[] {
  return (
    Array.isArray(words) &&
    words.length > 0 &&
    words.every(word => typeof word === "string" && pattern.test(word))
  );
}

function commandProblems(
  words: unknown,
  what: "command" | "old name"
): string[] {
  if (!Array.isArray(words) || words.length === 0) {
    return [`its ${what} has no words`];
  }
  const pattern = what === "command" ? WORD_PATTERN : OLD_WORD_PATTERN;
  const allowed =
    what === "command"
      ? "lower case letters, digits and inner hyphens"
      : "lower case letters, digits and inner hyphens or colons";
  return words
    .filter(word => typeof word !== "string" || !pattern.test(word))
    .map(word => `its ${what} word ${quoted(word)} is not ${allowed}`);
}

/** It says it comes from whoever registered it. */
const sourceProblems: DefinitionCheck = (op, contributor) => {
  const declared: unknown = op.source;
  if (isSource(declared) && sameSource(contributor, declared)) return [];
  const claimed = isSource(declared) ? describeSource(declared) : "nowhere";
  return [
    `it says it comes from ${claimed}, but ${describeSource(contributor)} registered it`,
  ];
};

/** Its command words, summary and description. */
const textProblems: DefinitionCheck = op => {
  const problems = commandProblems(op.command, "command");
  if (!isNonEmptyText(op.summary)) problems.push("it has no summary");
  else if (/[\r\n]/.test(op.summary)) {
    problems.push("its summary is more than one line");
  }
  if (!isNonEmptyText(op.description)) {
    problems.push("it has no description for agents");
  }
  return problems;
};

/** Its input and output are schemas the list can read. */
const schemaProblems: DefinitionCheck = op =>
  (["input", "output"] as const)
    .filter(name => {
      const standard = op[name]?.["~standard"];
      return (
        standard?.version !== 1 ||
        typeof standard.vendor !== "string" ||
        typeof standard.validate !== "function"
      );
    })
    .map(name => `its ${name} schema is not a Standard Schema`);

/** Its level, and where it refuses "Always allow". */
const levelProblems: DefinitionCheck = op => {
  if (!RISK_LEVELS.includes(op.level)) {
    return [
      `its level ${quoted(op.level)} is not one of ${RISK_LEVELS.join(", ")}`,
    ];
  }
  if (!isAbsentOrFalse(op.alwaysAllow)) {
    return [
      `its "Always allow" mark is ${quoted(op.alwaysAllow)}; it may only be false, or left out`,
    ];
  }
  if (op.alwaysAllow === false && op.level !== "critical") {
    return [
      `it refuses "Always allow" but its level is ${op.level}, not critical`,
    ];
  }
  return [];
};

/** A raise rule as plain JavaScript may hand it over: any value in any field. */
type UncheckedRule = Readonly<
  Partial<Record<"when" | "level" | "alwaysAllow" | "applies", unknown>>
>;

function isRiskLevel(value: unknown): value is RiskLevel {
  return RISK_LEVELS.some(level => level === value);
}

/** Where a rule's level sits against the operation's: known, and not lower. */
function raiseLevelProblems(
  op: OperationDefinition,
  rule: UncheckedRule,
  when: string
): string[] {
  if (!isRiskLevel(rule.level)) {
    return [
      `a raise rule's level ${quoted(rule.level)} is not one of ${RISK_LEVELS.join(", ")}`,
    ];
  }
  if (isRiskLevel(op.level) && levelRank(rule.level) < levelRank(op.level)) {
    return [
      `its raise rule "${when}" would lower the level from ${op.level} to ${rule.level}; an input may only raise it`,
    ];
  }
  if (!isAbsentOrFalse(rule.alwaysAllow)) {
    return [
      `its raise rule "${when}" has the "Always allow" mark ${quoted(rule.alwaysAllow)}; it may only be false, or left out`,
    ];
  }
  if (rule.alwaysAllow === false && rule.level !== "critical") {
    return [
      `its raise rule "${when}" refuses "Always allow" at ${rule.level}, not critical`,
    ];
  }
  return [];
}

/**
 * Its applies(): a function that answers at once. One written to answer
 * later hands back a promise, which is not a yes or a no.
 */
function appliesProblems(applies: unknown, when: string): string[] {
  if (typeof applies !== "function") {
    return [`its raise rule "${when}" has no applies()`];
  }
  if (Object.prototype.toString.call(applies) === "[object AsyncFunction]") {
    return [
      `its raise rule "${when}" answers later; applies() must answer yes or no at once`,
    ];
  }
  return [];
}

function raiseRuleProblems(
  op: OperationDefinition,
  rule: UncheckedRule
): string[] {
  const when = isNonEmptyText(rule.when) ? rule.when : quoted(rule.when);
  const problems = isNonEmptyText(rule.when)
    ? []
    : ["a raise rule does not say when it applies"];
  return problems.concat(
    raiseLevelProblems(op, rule, when),
    appliesProblems(rule.applies, when)
  );
}

/**
 * Every rule that raises its level only raises it. Declared as a list of
 * objects, since a plain JavaScript declaration may hold anything there.
 */
const raiseProblems: DefinitionCheck = op => {
  const rules: unknown = op.raise ?? [];
  if (!Array.isArray(rules)) return ["its raise rules are not a list"];
  return rules.flatMap((rule: unknown) =>
    isObject(rule)
      ? raiseRuleProblems(op, rule)
      : ["a raise rule is not an object"]
  );
};

/** Each effect stated, and none a read could not have. */
const effectsProblems: DefinitionCheck = op => {
  const effects: Partial<OperationEffects> = op.effects ?? {};
  const problems = EFFECTS.filter(key => typeof effects[key] !== "boolean").map(
    key => `its effects do not say whether it ${key}`
  );
  if (op.level === "read" && effects.destroys === true) {
    problems.push("its level is read but it destroys data");
  }
  return problems;
};

/** Its doors: a list of known doors, each named once. */
const doorsProblems: DefinitionCheck = op => {
  if (!Array.isArray(op.doors) || op.doors.length === 0) {
    return ["it names no doors"];
  }
  const problems = op.doors
    .filter(door => !DOORS.includes(door))
    .map(door => `its door ${quoted(door)} is not one of ${DOORS.join(", ")}`);
  if (new Set(op.doors).size !== op.doors.length) {
    problems.push("it names a door twice");
  }
  return problems;
};

/** The chat mark: a yes or a no, and a yes only with the chat door. */
const chatMarkProblems: DefinitionCheck = op => {
  if (op.chatExposed === undefined) return [];
  if (typeof op.chatExposed !== "boolean") {
    return [`its chat mark is ${quoted(op.chatExposed)}, not true or false`];
  }
  if (
    op.chatExposed &&
    !(Array.isArray(op.doors) && op.doors.includes("chat"))
  ) {
    return [
      "it is marked as seen by chat apps but does not run on the chat door",
    ];
  }
  return [];
};

/** Only core's fixed set of schema operations runs on the deploy door. */
const deployDoorProblems: DefinitionCheck = op => {
  if (!Array.isArray(op.doors) || !op.doors.includes("deploy")) return [];
  if (op.source?.kind !== "core") {
    return ["a plugin's operation may not run on the deploy door"];
  }
  if (!DEPLOY_DOOR_OPERATIONS.has(op.id)) {
    return [
      `it runs on the deploy door, which only ${[...DEPLOY_DOOR_OPERATIONS].join(", ")} may`,
    ];
  }
  // The deployment acts as itself, holding no person's stored permissions,
  // so what runs there is declared as schema upkeep.
  if (op.permission?.kind === "maintenance") return [];
  return [
    "it runs on the deploy door but is not a maintenance operation; the deployment holds no stored permission",
  ];
};

/** Its tool name and docs link, each text when given. */
const optionalTextProblems: DefinitionCheck = op =>
  (["toolName", "docs"] as const)
    .filter(key => op[key] !== undefined && !isNonEmptyText(op[key]))
    .map(key => `its ${key} is ${quoted(op[key])}, not text`);

/** An operation that reads only its plugin's own data, unchecked. */
function ownDataProblems(op: OperationDefinition): string[] {
  const problems: string[] = [];
  if (op.source?.kind !== "plugin") {
    problems.push(
      "only a plugin's operation may read its own data without a permission"
    );
  }
  if (op.level !== "read" || raises(op)) {
    problems.push(
      "an operation without a permission for its own data may only read"
    );
  }
  return problems;
}

/** A project or maintenance operation stays on the doors it is safe on. */
function unpermittedDoorProblems(
  op: OperationDefinition,
  kind: "project" | "maintenance"
): string[] {
  const allowed = DOORS_WITHOUT_PERMISSION[kind];
  // A doors value that is not a list is refused on its own.
  const doors: readonly string[] = Array.isArray(op.doors) ? op.doors : [];
  const outside = doors.filter(door => !allowed.includes(door));
  if (outside.length === 0) return [];
  return [
    `a ${kind} operation runs only on ${allowed.join(" and ")}, not ${outside.map(door => (typeof door === "string" ? door : quoted(door))).join(", ")}`,
  ];
}

/** A permission name, spelled as stored. */
function permissionNameProblems(name: unknown): string[] {
  if (!isNonEmptyText(name)) return ["its permission has no name"];
  if (isStoredPermission(name)) return [];
  return [
    `its permission ${quoted(name)} is not spelled as permissions are stored (<action>-<slug>, as read-posts)`,
  ];
}

/** The permission it needs, or why it needs none and where that is safe. */
const permissionProblems: DefinitionCheck = op => {
  const permission: Partial<{ kind: unknown; name: unknown; reason: unknown }> =
    op.permission ?? {};
  if (permission.kind === "permission")
    return permissionNameProblems(permission.name);
  if (
    permission.kind !== "project" &&
    permission.kind !== "maintenance" &&
    permission.kind !== "own-data"
  ) {
    return ["it does not say which permission it needs, or why it needs none"];
  }
  const problems = isNonEmptyText(permission.reason)
    ? []
    : [`it needs no permission (${permission.kind}) but gives no reason`];
  return problems.concat(
    permission.kind === "own-data"
      ? ownDataProblems(op)
      : unpermittedDoorProblems(op, permission.kind)
  );
};

/**
 * Whether it offers a dry run, which every writer must, except one that only
 * changes project files on the person's machine.
 */
const dryRunProblems: DefinitionCheck = op => {
  if (typeof op.dryRun !== "boolean") {
    return ["it does not say whether it supports a dry run"];
  }
  // An unknown level is refused on its own; whether it writes is not known.
  if (!RISK_LEVELS.includes(op.level)) return [];
  const writes = op.level !== "read" || raises(op);
  if (writes && op.permission?.kind !== "project" && !op.dryRun) {
    return ["it writes but offers no dry run"];
  }
  return [];
};

/** Whether it runs in the background. */
const longProblems: DefinitionCheck = op =>
  typeof op.long === "boolean"
    ? []
    : ["it does not say whether it is long-running"];

/** At least one example, each with a summary; parsing them comes later. */
const exampleShapeProblems: DefinitionCheck = op => {
  if (!Array.isArray(op.examples) || op.examples.length === 0) {
    return ["it has no example"];
  }
  return op.examples
    .filter(example => !isNonEmptyText(example?.summary))
    .map(() => "an example has no summary");
};

function exitCodeProblems({ code, meaning }: OperationExitCode): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(code) || code < 0 || code > 255) {
    problems.push(
      `its exit code ${quoted(code)} is not a whole number from 0 to 255`
    );
  } else if (code !== 2 && code in SHARED_EXIT_CODES) {
    problems.push(
      `it gives exit code ${quoted(code)} a meaning of its own; ${quoted(code)} always means "${SHARED_EXIT_CODES[code]}"`
    );
  }
  if (!isNonEmptyText(meaning)) {
    problems.push(`its exit code ${quoted(code)} has no meaning`);
  }
  return problems;
}

/** The exit codes it adds, none redefining a shared one or listed twice. */
const exitCodesProblems: DefinitionCheck = op => {
  if (!Array.isArray(op.exitCodes)) {
    return ["it does not list the exit codes it adds"];
  }
  const entries: unknown[] = op.exitCodes;
  const listed = entries.filter(isObject) as OperationExitCode[];
  const problems = listed.flatMap(exitCodeProblems);
  if (listed.length < entries.length) {
    problems.push("an exit code entry is not an object");
  }
  const codes = listed.map(entry => entry.code);
  for (const code of new Set(codes)) {
    if (codes.indexOf(code) !== codes.lastIndexOf(code)) {
      problems.push(`it lists exit code ${quoted(code)} twice`);
    }
  }
  return problems;
};

/** Its old names, each with the releases that bound it. */
const aliasesProblems: DefinitionCheck = op => {
  if (!Array.isArray(op.aliases)) return ["it does not list its old names"];
  return op.aliases.flatMap(alias => {
    const problems = commandProblems(alias?.command, "old name");
    if (
      !isNonEmptyText(alias?.addedIn) ||
      !isNonEmptyText(alias?.removableFrom)
    ) {
      problems.push(
        "an old name does not say the release that added it and the earliest that may remove it"
      );
    }
    return problems;
  });
};

/** Whether it is experimental or stable. */
const stabilityProblems: DefinitionCheck = op =>
  op.stability === "experimental" || op.stability === "stable"
    ? []
    : [
        `its stability ${quoted(op.stability)} is neither experimental nor stable`,
      ];

/** Every rule a declaration keeps on its own, in the order a refusal lists them. */
const DEFINITION_CHECKS: readonly DefinitionCheck[] = [
  sourceProblems,
  textProblems,
  schemaProblems,
  levelProblems,
  raiseProblems,
  effectsProblems,
  doorsProblems,
  chatMarkProblems,
  deployDoorProblems,
  permissionProblems,
  dryRunProblems,
  longProblems,
  exampleShapeProblems,
  exitCodesProblems,
  aliasesProblems,
  stabilityProblems,
  optionalTextProblems,
];

/** Why each of `op`'s examples does not parse against its input schema. */
async function examplesProblems(op: OperationDefinition): Promise<string[]> {
  const problems: string[] = [];
  for (const example of op.examples) {
    let result: Awaited<ReturnType<(typeof op.input)["~standard"]["validate"]>>;
    try {
      result = await op.input["~standard"].validate(example.input);
    } catch (error) {
      // A hand-made schema may throw rather than answer; the refusal still
      // names the operation it belongs to.
      const reason = error instanceof Error ? error.message : quoted(error);
      problems.push(
        `its example "${example.summary}" could not be checked: ${reason}`
      );
      continue;
    }
    const problem = exampleResultProblem(example.summary, result);
    if (problem) problems.push(problem);
  }
  return problems;
}

/**
 * Why a schema's answer for one example refuses it: the issues it found, or
 * an answer that is neither a parsed value nor a list of issues, which a
 * hand-made schema might give and which proves nothing about the example.
 */
function exampleResultProblem(
  summary: string,
  result: unknown
): string | undefined {
  if (isObject(result) && "issues" in result && result.issues !== undefined) {
    if (!Array.isArray(result.issues)) {
      return `its input schema answered example "${summary}" with issues that are not a list`;
    }
    const issues = result.issues
      .map((issue: unknown) =>
        isObject(issue) && "message" in issue
          ? quoted(issue.message)
          : quoted(issue)
      )
      .join("; ");
    return `its example "${summary}" does not parse against its input schema: ${issues}`;
  }
  if (isObject(result) && "value" in result) return undefined;
  return `its input schema answered example "${summary}" with ${quoted(result)}, which is neither a parsed value nor a list of issues`;
}

/** Who first claimed an ID or a set of command words. */
interface Claim {
  readonly id: string;
  readonly from: string;
  /** Its command words, as a refusal quotes them. */
  readonly command: string;
}

/** The words `op` answers to: its command and each old name. */
function claimedWords(op: OperationDefinition): string[][] {
  const aliases = Array.isArray(op.aliases) ? op.aliases : [];
  // Only well-formed words claim anything; any other is refused on its own.
  return [
    ...(areWords(op.command, WORD_PATTERN) ? [op.command] : []),
    ...aliases
      .map(alias => alias?.command)
      .filter((words): words is string[] => areWords(words, OLD_WORD_PATTERN)),
  ];
}

/**
 * The command words `op` claims that an earlier operation, or `op` itself,
 * already claimed. Records `op`'s new claims in `byWords`.
 */
function wordClaimProblems(
  op: OperationDefinition,
  claim: Claim,
  byWords: Map<string, Claim>
): string[] {
  const problems: string[] = [];
  const claimedHere = new Set<string>();
  for (const words of claimedWords(op)) {
    const key = words.join(" ");
    const holder = byWords.get(key);
    if (holder && !claimedHere.has(key)) {
      problems.push(
        `Two operations claim the command words "nextly ${key}": "${holder.id}" from ${holder.from} and "${claim.id}" from ${claim.from}`
      );
    } else if (claimedHere.has(key)) {
      problems.push(
        `Operation "${claim.id}" from ${claim.from}: it claims the command words "nextly ${key}" twice`
      );
    } else {
      byWords.set(key, claim);
    }
    claimedHere.add(key);
  }
  return problems;
}

/** Everything wrong with `op` on its own, each sentence naming it. */
async function operationProblems(
  op: OperationDefinition,
  contributor: OperationSource,
  claim: Claim
): Promise<string[]> {
  const own = DEFINITION_CHECKS.flatMap(check => check(op, contributor));
  if (!ID_PATTERN.test(claim.id)) {
    own.unshift("its ID is not dotted lower-case words (noun.verb)");
  }
  // Only a declaration whose own shape is sound has examples and a schema
  // worth parsing them with.
  if (own.length === 0) own.push(...(await examplesProblems(op)));
  return own.map(
    problem => `Operation "${claim.id}" from ${claim.from}: ${problem}`
  );
}

/** Why a contributor's whole registration is refused, or nothing. */
function contributionProblem(
  source: OperationSource,
  operations: unknown
): string | undefined {
  if (!isSource(source)) {
    return `Operations were registered by a plugin with no name: ${quoted(source)}`;
  }
  if (!Array.isArray(operations)) {
    return `${describeSource(source)} registered operations that are not a list: ${quoted(operations)}`;
  }
  return undefined;
}

/** What earlier operations in the list have claimed. */
interface Claims {
  readonly byId: Map<string, Claim>;
  readonly byWords: Map<string, Claim>;
}

/** How a refusal tells apart two operations that share an ID. */
function describeCommand(op: OperationDefinition): string {
  // Words that are not text are refused on their own; quoting them here
  // keeps this description from failing on one.
  return Array.isArray(op.command)
    ? `"nextly ${op.command.map(word => (typeof word === "string" ? word : quoted(word))).join(" ")}"`
    : "no command";
}

/**
 * Everything wrong with `op`: its own declaration, and the ID and command
 * words it claims that an earlier operation holds. Records its claims.
 */
async function declarationProblems(
  op: OperationDefinition,
  source: OperationSource,
  from: string,
  claims: Claims
): Promise<string[]> {
  const hasId = isNonEmptyText(op.id);
  const claim: Claim = {
    id: hasId ? op.id : "(no ID)",
    from,
    command: describeCommand(op),
  };
  const problems = await operationProblems(op, source, claim);
  // An operation without an ID is already refused; it claims no ID to clash.
  const earlier = hasId ? claims.byId.get(op.id) : undefined;
  if (earlier) {
    problems.push(
      `Two operations claim the ID "${op.id}": one from ${earlier.from} (${earlier.command}) and one from ${from} (${claim.command})`
    );
  } else if (hasId) {
    claims.byId.set(op.id, claim);
  }
  problems.push(...wordClaimProblems(op, claim, claims.byWords));
  return problems;
}

/**
 * Every problem with the list `contributions` would make, as sentences that
 * name the operation and where it came from. Empty when the list may be used.
 */
export async function operationListProblems(
  contributions: readonly OperationContribution[]
): Promise<string[]> {
  const problems: string[] = [];
  const byId = new Map<string, Claim>();
  const byWords = new Map<string, Claim>();

  for (const { source, operations } of contributions) {
    const refused = contributionProblem(source, operations);
    if (refused) {
      problems.push(refused);
      continue;
    }
    const from = describeSource(source);
    for (const op of operations as readonly unknown[]) {
      if (!isObject(op)) {
        problems.push(
          `An entry from ${from} is not an operation: ${quoted(op)}`
        );
        continue;
      }
      problems.push(
        ...(await declarationProblems(op as OperationDefinition, source, from, {
          byId,
          byWords,
        }))
      );
    }
  }
  return problems;
}
