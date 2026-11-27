/**
 * The one list of operations, assembled from core's and each plugin's
 * declarations, and the read-only view every door reads: the CLI builds its
 * commands from it, the agent doors their tools, and the reference its pages.
 *
 * Assembly refuses to finish when the start-up checks find any problem, so a
 * process never runs with two operations behind one name or with a
 * declaration that leaves a fact out.
 *
 * @module operations/list
 * @experimental
 */
import { NextlyError } from "../errors/nextly-error";

import type { OperationDefinition } from "./definition";
import {
  operationListProblems,
  type OperationContribution,
} from "./start-up-checks";

/**
 * An operation as the list holds it: its declaration, with the two marks that
 * are off unless declared filled in, so a reader never has to know a default.
 */
export type ListedOperation = Omit<
  OperationDefinition,
  "chatExposed" | "alwaysAllow"
> & {
  /** Whether chat apps may see it. */
  readonly chatExposed: boolean;
  /** Whether "Always allow" may cover a run at the declared level. */
  readonly alwaysAllow: boolean;
};

/** The assembled list, read-only. */
export interface OperationList {
  /** Core's operations first, then each plugin's, in the order given. */
  readonly operations: readonly ListedOperation[];
  /** The operation with this ID. */
  byId(id: string): ListedOperation | undefined;
  /** The operation these command words run, by its name or an old one. */
  byCommand(words: readonly string[]): ListedOperation | undefined;
}

/** What the list is made from: core's operations, then each plugin's. */
export interface OperationListSources {
  readonly core: readonly OperationDefinition[];
  readonly plugins?: readonly {
    readonly name: string;
    readonly operations: readonly OperationDefinition[];
  }[];
}

/**
 * Whether `value` is data a declaration holds and the list copies: any array
 * or object, a class instance included, so a fact declared as one is
 * snapshotted like a literal. Functions are not objects here and stay as given.
 */
function isPlainData(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * A frozen deep copy of data: arrays and objects, at every depth. A copy keeps
 * its original's prototype, so a class instance's methods still answer while
 * its own fields are fixed. Functions are kept as they are, since the list
 * calls them rather than reading them.
 */
function frozenCopy<T>(value: T, copies = new Map<object, object>()): T {
  if (!isPlainData(value)) return value;
  const done = copies.get(value);
  if (done) return done as T;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value) as object | null);
  copies.set(value, copy);
  if (Array.isArray(value) && Array.isArray(copy)) {
    // Every index, holes included: a hole becomes `undefined`, which the
    // checks then refuse like any other missing entry.
    for (let index = 0; index < value.length; index++) {
      copy.push(frozenCopy<unknown>(value[index], copies));
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      // Defined rather than assigned, so a key such as `__proto__` stays a
      // key of its own instead of reaching the object's prototype.
      Object.defineProperty(copy, key, {
        value: frozenCopy(entry, copies),
        enumerable: true,
      });
    }
  }
  return Object.freeze(copy) as T;
}

/** The two fields that hold schemas, kept as given whatever they are made of. */
const SCHEMA_FIELDS: ReadonlySet<string> = new Set(["input", "output"]);

/**
 * A declaration as the list checks and serves it: a frozen copy of its own
 * fields, made whatever kind of object it was declared as, with its schemas
 * kept as given (their marker may not be a property a copy would carry over)
 * and every other field deep-copied. A declarer that keeps its object and
 * changes it later (pushing a door, say) changes nothing the checks passed.
 */
function copyDeclaration(op: unknown): unknown {
  if (typeof op !== "object" || op === null) return op;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(op)) {
    Object.defineProperty(copy, key, {
      value: SCHEMA_FIELDS.has(key) ? entry : frozenCopy<unknown>(entry),
      enumerable: true,
    });
  }
  return Object.freeze(copy);
}

/** Each declaration in `operations` copied, or `operations` as given when it is not a list. */
function copyOperations(operations: unknown): OperationDefinition[] {
  const copied: unknown = Array.isArray(operations)
    ? Object.freeze(Array.from(operations, copyDeclaration))
    : operations;
  // The checks refuse a value that is not a list, and each entry that is not
  // a declaration, by name.
  return copied as OperationDefinition[];
}

/**
 * Who registered operations, as plain JavaScript may have given them: a
 * contribution for each plugin entry that is an object, and the problems with
 * the rest.
 */
function pluginContributions(plugins: unknown): {
  contributions: OperationContribution[];
  problems: string[];
} {
  if (plugins === undefined) return { contributions: [], problems: [] };
  if (!Array.isArray(plugins)) {
    return {
      contributions: [],
      problems: ["The plugins given are not a list"],
    };
  }
  const contributions: OperationContribution[] = [];
  const problems: string[] = [];
  Array.from(plugins).forEach((plugin: unknown, index) => {
    if (typeof plugin !== "object" || plugin === null) {
      problems.push(`Plugin entry ${index + 1} is not an object`);
      return;
    }
    const name: unknown = "name" in plugin ? plugin.name : undefined;
    const operations: unknown =
      "operations" in plugin ? plugin.operations : undefined;
    contributions.push({
      // A name that is not text is refused by the checks, by name.
      source: { kind: "plugin", name: name as string },
      operations: copyOperations(operations),
    });
  });
  return { contributions, problems };
}

/**
 * The key a run of command words is found by. Each word stays a word, so
 * `["posts list"]` is not `["posts", "list"]`.
 */
function wordsKey(words: readonly string[]): string {
  return JSON.stringify(words);
}

function listed(op: OperationDefinition): ListedOperation {
  return Object.freeze({
    ...op,
    chatExposed: op.chatExposed === true,
    alwaysAllow: op.alwaysAllow !== false,
  });
}

/**
 * Checks every declaration and assembles the list, or refuses with every
 * problem found, each naming the operation and where it came from.
 *
 * @throws NextlyError (`INVALID_INPUT`) when any start-up check fails.
 */
export async function assembleOperationList(
  sources: OperationListSources
): Promise<OperationList> {
  const plugins = pluginContributions(sources.plugins);
  const contributions: OperationContribution[] = [
    { source: { kind: "core" }, operations: copyOperations(sources.core) },
    ...plugins.contributions,
  ];
  const problems = [
    ...plugins.problems,
    ...(await operationListProblems(contributions)),
  ];
  if (problems.length > 0) {
    throw NextlyError.invalidInput({
      message: [
        `Nextly can't start: the operation list has ${problems.length === 1 ? "a problem" : `${problems.length} problems`}.`,
        ...problems.map(problem => `- ${problem}`),
      ].join("\n"),
      logContext: { problems },
    });
  }

  const operations = Object.freeze(
    contributions.flatMap(({ operations: ops }) => ops.map(listed))
  );
  const byId = new Map(operations.map(op => [op.id, op]));
  // The checks above refused any two claims on one set of words, so each key
  // has one operation.
  const byWords = new Map<string, ListedOperation>();
  for (const op of operations) {
    byWords.set(wordsKey(op.command), op);
    for (const alias of op.aliases) byWords.set(wordsKey(alias.command), op);
  }
  return Object.freeze({
    operations,
    byId: (id: string) => byId.get(id),
    byCommand: (words: readonly string[]) => byWords.get(wordsKey(words)),
  });
}
