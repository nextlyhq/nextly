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
import {
  DOORS,
  RISK_LEVELS,
  SHARED_EXIT_CODES,
  type OperationDefinition,
  type OperationEffects,
  type OperationExitCode,
  type OperationRaise,
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

/** The doors on which an operation that needs no permission may run. */
const DOORS_WITHOUT_PERMISSION: Readonly<
  Record<"project" | "maintenance", readonly string[]>
> = {
  // Only the person's own project folder holds the files it changes.
  project: ["local"],
  // Schema upkeep runs where the person owns the database, or in a deploy.
  maintenance: ["local", "deploy"],
};

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

function quoted(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whether `op` declares any rule that raises its level. */
function raises(op: OperationDefinition): boolean {
  return Array.isArray(op.raise) && op.raise.some(isObject);
}

function isSource(value: unknown): value is OperationSource {
  return typeof value === "object" && value !== null && "kind" in value;
}

function sameSource(a: OperationSource, b: OperationSource): boolean {
  if (a.kind === "core" || b.kind === "core") return a.kind === b.kind;
  return a.name === b.name;
}

function commandProblems(words: unknown, what: string): string[] {
  if (!Array.isArray(words) || words.length === 0) {
    return [`its ${what} has no words`];
  }
  return words
    .filter(word => typeof word !== "string" || !WORD_PATTERN.test(word))
    .map(
      word =>
        `its ${what} word ${quoted(word)} is not lower case letters, digits and inner hyphens`
    );
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
      return standard?.version !== 1 || typeof standard.validate !== "function";
    })
    .map(name => `its ${name} schema is not a Standard Schema`);

/** Its level, and where it refuses "Always allow". */
const levelProblems: DefinitionCheck = op => {
  if (!RISK_LEVELS.includes(op.level)) {
    return [
      `its level ${quoted(op.level)} is not one of ${RISK_LEVELS.join(", ")}`,
    ];
  }
  if (op.alwaysAllow === false && op.level !== "critical") {
    return [
      `it refuses "Always allow" but its level is ${op.level}, not critical`,
    ];
  }
  return [];
};

function raiseRuleProblems(
  op: OperationDefinition,
  rule: OperationRaise<unknown>
): string[] {
  const problems: string[] = [];
  if (!isNonEmptyText(rule.when)) {
    problems.push("a raise rule does not say when it applies");
  }
  if (!RISK_LEVELS.includes(rule.level)) {
    problems.push(
      `a raise rule's level ${quoted(rule.level)} is not one of ${RISK_LEVELS.join(", ")}`
    );
  } else if (
    RISK_LEVELS.includes(op.level) &&
    levelRank(rule.level) < levelRank(op.level)
  ) {
    problems.push(
      `its raise rule "${rule.when}" would lower the level from ${op.level} to ${rule.level}; an input may only raise it`
    );
  }
  if (rule.alwaysAllow === false && rule.level !== "critical") {
    problems.push(
      `its raise rule "${rule.when}" refuses "Always allow" at ${rule.level}, not critical`
    );
  }
  if (typeof rule.applies !== "function") {
    problems.push(`its raise rule "${rule.when}" has no applies()`);
  }
  return problems;
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
      ? raiseRuleProblems(op, rule as OperationRaise<unknown>)
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

/** Its doors, and the chat mark that needs the chat door. */
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
  if (op.doors.includes("deploy") && op.source?.kind !== "core") {
    problems.push("a plugin's operation may not run on the deploy door");
  }
  if (op.chatExposed === true && !op.doors.includes("chat")) {
    problems.push(
      "it is marked as seen by chat apps but does not run on the chat door"
    );
  }
  return problems;
};

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
  const outside = (op.doors ?? []).filter(door => !allowed.includes(door));
  if (outside.length === 0) return [];
  return [
    `a ${kind} operation runs only on ${allowed.join(" and ")}, not ${outside.join(", ")}`,
  ];
}

/** The permission it needs, or why it needs none and where that is safe. */
const permissionProblems: DefinitionCheck = op => {
  const permission: Partial<{ kind: unknown; name: unknown; reason: unknown }> =
    op.permission ?? {};
  if (permission.kind === "permission") {
    return isNonEmptyText(permission.name)
      ? []
      : ["its permission has no name"];
  }
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
      `it gives exit code ${code} a meaning of its own; ${code} always means "${SHARED_EXIT_CODES[code]}"`
    );
  }
  if (!isNonEmptyText(meaning)) {
    problems.push(`its exit code ${code} has no meaning`);
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
      problems.push(`it lists exit code ${code} twice`);
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
  permissionProblems,
  dryRunProblems,
  longProblems,
  exampleShapeProblems,
  exitCodesProblems,
  aliasesProblems,
  stabilityProblems,
];

/** Why each of `op`'s examples does not parse against its input schema. */
async function examplesProblems(op: OperationDefinition): Promise<string[]> {
  const problems: string[] = [];
  for (const example of op.examples) {
    const result = await op.input["~standard"].validate(example.input);
    if (!result.issues) continue;
    const issues = result.issues.map(issue => issue.message).join("; ");
    problems.push(
      `its example "${example.summary}" does not parse against its input schema: ${issues}`
    );
  }
  return problems;
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
  return [op.command, ...aliases.map(alias => alias?.command)].filter(
    (words): words is string[] => Array.isArray(words) && words.length > 0
  );
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

/** What earlier operations in the list have claimed. */
interface Claims {
  readonly byId: Map<string, Claim>;
  readonly byWords: Map<string, Claim>;
}

/** How a refusal tells apart two operations that share an ID. */
function describeCommand(op: OperationDefinition): string {
  return Array.isArray(op.command)
    ? `"nextly ${op.command.join(" ")}"`
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
