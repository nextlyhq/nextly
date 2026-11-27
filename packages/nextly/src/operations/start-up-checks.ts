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

/** How a refusal names where an operation came from. */
export function describeSource(source: OperationSource): string {
  return source.kind === "core" ? "core" : `plugin "${source.name}"`;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameSource(a: OperationSource, b: unknown): boolean {
  if (typeof b !== "object" || b === null || !("kind" in b)) return false;
  if (a.kind === "core") return b.kind === "core";
  return b.kind === "plugin" && "name" in b && b.name === a.name;
}

function commandProblems(words: unknown, what: string): string[] {
  if (!Array.isArray(words) || words.length === 0) {
    return [`its ${what} has no words`];
  }
  return words
    .filter(word => typeof word !== "string" || !WORD_PATTERN.test(word))
    .map(
      word =>
        `its ${what} word ${JSON.stringify(word)} is not lower case letters, digits and inner hyphens`
    );
}

/** What is wrong with one declaration on its own, each as a short clause. */
function definitionProblems(
  op: OperationDefinition,
  contributor: OperationSource
): string[] {
  const problems: string[] = [];

  if (!sameSource(contributor, op.source)) {
    problems.push(
      `it says it comes from ${typeof op.source === "object" && op.source !== null ? describeSource(op.source) : "nowhere"}, but ${describeSource(contributor)} registered it`
    );
  }
  problems.push(...commandProblems(op.command, "command"));
  if (!isNonEmptyText(op.summary)) problems.push("it has no summary");
  else if (/[\r\n]/.test(op.summary))
    problems.push("its summary is more than one line");
  if (!isNonEmptyText(op.description))
    problems.push("it has no description for agents");
  for (const [name, schema] of [
    ["input", op.input],
    ["output", op.output],
  ] as const) {
    if (schema?.["~standard"]?.version !== 1) {
      problems.push(`its ${name} schema is not a Standard Schema`);
    }
  }

  const levelKnown = RISK_LEVELS.includes(op.level);
  if (!levelKnown)
    problems.push(
      `its level ${JSON.stringify(op.level)} is not one of ${RISK_LEVELS.join(", ")}`
    );
  if (op.alwaysAllow === false && op.level !== "critical") {
    problems.push(
      `it refuses "Always allow" but its level is ${op.level}, not critical`
    );
  }
  for (const rule of op.raise ?? []) {
    if (!isNonEmptyText(rule.when))
      problems.push("a raise rule does not say when it applies");
    if (!RISK_LEVELS.includes(rule.level)) {
      problems.push(
        `a raise rule's level ${JSON.stringify(rule.level)} is not one of ${RISK_LEVELS.join(", ")}`
      );
    } else if (levelKnown && levelRank(rule.level) < levelRank(op.level)) {
      problems.push(
        `its raise rule "${rule.when}" would lower the level from ${op.level} to ${rule.level}; an input may only raise it`
      );
    }
    if (rule.alwaysAllow === false && rule.level !== "critical") {
      problems.push(
        `its raise rule "${rule.when}" refuses "Always allow" at ${rule.level}, not critical`
      );
    }
    if (typeof rule.applies !== "function")
      problems.push(`its raise rule "${rule.when}" has no applies()`);
  }

  const effects = op.effects;
  for (const key of [
    "destroys",
    "idempotent",
    "outside",
    "spendsAi",
  ] as const) {
    if (typeof effects?.[key] !== "boolean")
      problems.push(`its effects do not say whether it ${key}`);
  }
  if (op.level === "read" && effects?.destroys === true) {
    problems.push("its level is read but it destroys data");
  }

  if (!Array.isArray(op.doors) || op.doors.length === 0) {
    problems.push("it names no doors");
  } else {
    for (const door of op.doors) {
      if (!DOORS.includes(door))
        problems.push(
          `its door ${JSON.stringify(door)} is not one of ${DOORS.join(", ")}`
        );
    }
    if (new Set(op.doors).size !== op.doors.length)
      problems.push("it names a door twice");
    if (op.doors.includes("deploy") && op.source?.kind !== "core") {
      problems.push("a plugin's operation may not run on the deploy door");
    }
  }
  if (op.chatExposed === true && !op.doors?.includes("chat")) {
    problems.push(
      "it is marked as seen by chat apps but does not run on the chat door"
    );
  }

  const permission = op.permission;
  if (permission?.kind === "permission") {
    if (!isNonEmptyText(permission.name))
      problems.push("its permission has no name");
  } else if (
    permission?.kind === "project" ||
    permission?.kind === "maintenance" ||
    permission?.kind === "own-data"
  ) {
    if (!isNonEmptyText(permission.reason)) {
      problems.push(
        `it needs no permission (${permission.kind}) but gives no reason`
      );
    }
    if (permission.kind === "own-data") {
      if (op.source?.kind !== "plugin")
        problems.push(
          "only a plugin's operation may read its own data without a permission"
        );
      if (op.level !== "read" || (op.raise ?? []).length > 0) {
        problems.push(
          "an operation without a permission for its own data may only read"
        );
      }
    } else {
      const allowed = DOORS_WITHOUT_PERMISSION[permission.kind];
      const outside = (op.doors ?? []).filter(door => !allowed.includes(door));
      if (outside.length > 0) {
        problems.push(
          `a ${permission.kind} operation runs only on ${allowed.join(" and ")}, not ${outside.join(", ")}`
        );
      }
    }
  } else {
    problems.push(
      "it does not say which permission it needs, or why it needs none"
    );
  }

  if (typeof op.dryRun !== "boolean")
    problems.push("it does not say whether it supports a dry run");
  const writes = op.level !== "read" || (op.raise ?? []).length > 0;
  if (writes && permission?.kind !== "project" && op.dryRun !== true) {
    problems.push("it writes but offers no dry run");
  }
  if (typeof op.long !== "boolean")
    problems.push("it does not say whether it is long-running");

  if (!Array.isArray(op.examples) || op.examples.length === 0) {
    problems.push("it has no example");
  } else {
    for (const example of op.examples) {
      if (!isNonEmptyText(example?.summary))
        problems.push("an example has no summary");
    }
  }

  if (!Array.isArray(op.exitCodes)) {
    problems.push("it does not list the exit codes it adds");
  } else {
    const seen = new Set<number>();
    for (const { code, meaning } of op.exitCodes) {
      if (!Number.isInteger(code) || code < 0 || code > 255) {
        problems.push(
          `its exit code ${JSON.stringify(code)} is not a whole number from 0 to 255`
        );
      } else if (code !== 2 && code in SHARED_EXIT_CODES) {
        problems.push(
          `it gives exit code ${code} a meaning of its own; ${code} always means "${SHARED_EXIT_CODES[code]}"`
        );
      }
      if (seen.has(code)) problems.push(`it lists exit code ${code} twice`);
      seen.add(code);
      if (!isNonEmptyText(meaning))
        problems.push(`its exit code ${code} has no meaning`);
    }
  }

  if (!Array.isArray(op.aliases)) {
    problems.push("it does not list its old names");
  } else {
    for (const alias of op.aliases) {
      problems.push(...commandProblems(alias?.command, "old name"));
      if (
        !isNonEmptyText(alias?.addedIn) ||
        !isNonEmptyText(alias?.removableFrom)
      ) {
        problems.push(
          "an old name does not say the release that added it and the earliest that may remove it"
        );
      }
    }
  }

  if (op.stability !== "experimental" && op.stability !== "stable") {
    problems.push(
      `its stability ${JSON.stringify(op.stability)} is neither experimental nor stable`
    );
  }
  return problems;
}

/** Why `example` does not parse against `op`'s input schema, or nothing. */
async function exampleProblem(
  op: OperationDefinition,
  example: { readonly summary: string; readonly input: unknown }
): Promise<string | undefined> {
  const result = await op.input["~standard"].validate(example.input);
  if (!result.issues) return undefined;
  const issues = result.issues.map(issue => issue.message).join("; ");
  return `its example "${example.summary}" does not parse against its input schema: ${issues}`;
}

/**
 * Every problem with the list `contributions` would make, as sentences that
 * name the operation and where it came from. Empty when the list may be used.
 */
export async function operationListProblems(
  contributions: readonly OperationContribution[]
): Promise<string[]> {
  const problems: string[] = [];
  const byId = new Map<string, { id: string; from: string }>();
  const byWords = new Map<string, { id: string; from: string }>();

  for (const { source, operations } of contributions) {
    const from = describeSource(source);
    for (const op of operations) {
      const id = isNonEmptyText(op.id) ? op.id : "(no ID)";
      const name = `Operation "${id}" from ${from}`;
      if (!ID_PATTERN.test(id)) {
        problems.push(
          `${name}: its ID is not dotted lower-case words (noun.verb)`
        );
      }
      const own = definitionProblems(op, source);
      problems.push(...own.map(problem => `${name}: ${problem}`));

      // Only a declaration whose own shape is sound has examples and a
      // schema worth parsing them with.
      if (own.length === 0) {
        for (const example of op.examples) {
          const problem = await exampleProblem(op, example);
          if (problem) problems.push(`${name}: ${problem}`);
        }
      }

      const earlier = byId.get(id);
      if (earlier) {
        problems.push(
          `Two operations claim the ID "${id}": one from ${earlier.from} and one from ${from}`
        );
      } else {
        byId.set(id, { id, from });
      }

      const claims = [
        op.command,
        ...(Array.isArray(op.aliases)
          ? op.aliases.map(alias => alias?.command)
          : []),
      ];
      const claimedHere = new Set<string>();
      for (const words of claims) {
        if (!Array.isArray(words) || words.length === 0) continue;
        const key = words.join(" ");
        const holder = byWords.get(key);
        if (holder) {
          problems.push(
            `Two operations claim the command words "nextly ${key}": "${holder.id}" from ${holder.from} and "${id}" from ${from}`
          );
        } else if (claimedHere.has(key)) {
          problems.push(
            `${name}: it claims the command words "nextly ${key}" twice`
          );
        }
        claimedHere.add(key);
      }
      for (const key of claimedHere) {
        if (!byWords.has(key)) byWords.set(key, { id, from });
      }
    }
  }
  return problems;
}
