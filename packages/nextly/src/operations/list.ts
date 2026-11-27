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
 * How a copy treats an object that is not an array:
 * - `facts`: every object becomes plain data, its own fields copied and its
 *   class dropped, for the fields the checks judge (doors, effects,
 *   permission, ...). The list reads these as data, so a class instance there
 *   is snapshotted rather than left as the declarer's live object.
 * - `values`: only object literals are copied; any other object (a Date, a
 *   Map, a Set, a typed array, a schema, a class with private fields) is kept
 *   as given, for the fields that carry values rather than state facts
 *   (examples and raise rules). Such objects keep their data in internal slots
 *   or private fields that no copy of their own fields carries, so a copy would
 *   answer nothing: the example would no longer parse, or a raise rule's
 *   `applies` would throw.
 */
type CopyMode = "facts" | "values";

/** Whether `value` was written as an object literal, or made with no prototype. */
function isObjectLiteral(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a copy by `mode` keeps the object `value` as given: as `values`, any
 * object that is neither an array nor a literal.
 */
function keptAsGiven(value: object, mode: CopyMode): boolean {
  return mode === "values" && !Array.isArray(value) && !isObjectLiteral(value);
}

/**
 * The empty copy `value`'s fields are put into: an array for an array; for a
 * literal, an object with its prototype (Object's, or none); and for a class
 * instance in a fact, a plain object.
 */
function emptyCopyOf(value: object): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return [];
  return isObjectLiteral(value)
    ? (Object.create(Object.getPrototypeOf(value) as object | null) as Record<
        string,
        unknown
      >)
    : {};
}

/**
 * A frozen deep copy of `value` by `mode`, at every depth. Anything that is not
 * an object is kept as it is (a function included, which the list calls rather
 * than reads), and so is an object `keptAsGiven` keeps.
 */
function frozenCopy<T>(
  value: T,
  mode: CopyMode,
  copies = new Map<object, object>()
): T {
  if (typeof value !== "object" || value === null) return value;
  if (keptAsGiven(value, mode)) return value;
  const source: object = value;
  const done = copies.get(source);
  if (done) return done as T;
  const copy = emptyCopyOf(source);
  copies.set(source, copy);
  if (Array.isArray(source) && Array.isArray(copy)) {
    // Every index, holes included: a hole becomes `undefined`, which the
    // checks then refuse like any other missing entry.
    for (let index = 0; index < source.length; index++) {
      copy.push(frozenCopy<unknown>(source[index], mode, copies));
    }
  } else {
    for (const [key, entry] of Object.entries(source)) {
      // Defined rather than assigned, so a key such as `__proto__` stays a
      // key of its own instead of reaching the object's prototype.
      Object.defineProperty(copy, key, {
        value: frozenCopy(entry, mode, copies),
        enumerable: true,
      });
    }
  }
  return Object.freeze(copy) as T;
}

/** The two fields that hold schemas, kept as given whatever they are made of. */
const SCHEMA_FIELDS: ReadonlySet<string> = new Set(["input", "output"]);

/** The fields that carry values rather than state facts, copied as `values`. */
const VALUE_FIELDS: ReadonlySet<string> = new Set(["examples", "raise"]);

/**
 * A declaration as the list checks and serves it: a frozen copy of its own
 * fields, made whatever kind of object it was declared as. Its schemas are
 * kept as given (their marker may not be a property a copy would carry over),
 * its examples and raise rules are copied as `values`, and every other field
 * is copied as `facts`. A declarer that keeps its object and changes it later
 * (pushing a door, say) changes nothing the checks passed.
 */
function copyDeclaration(op: unknown): unknown {
  if (typeof op !== "object" || op === null) return op;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(op)) {
    Object.defineProperty(copy, key, {
      value: SCHEMA_FIELDS.has(key)
        ? entry
        : frozenCopy<unknown>(
            entry,
            VALUE_FIELDS.has(key) ? "values" : "facts"
          ),
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
