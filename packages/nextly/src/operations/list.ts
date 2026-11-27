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
  const contributions: OperationContribution[] = [
    { source: { kind: "core" }, operations: sources.core },
    ...(sources.plugins ?? []).map(plugin => ({
      source: { kind: "plugin" as const, name: plugin.name },
      operations: plugin.operations,
    })),
  ];
  const problems = await operationListProblems(contributions);
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
    byWords.set(op.command.join(" "), op);
    for (const alias of op.aliases) byWords.set(alias.command.join(" "), op);
  }
  return Object.freeze({
    operations,
    byId: (id: string) => byId.get(id),
    byCommand: (words: readonly string[]) => byWords.get(words.join(" ")),
  });
}
