/**
 * What one operation is: a thing Nextly can do (create a migration, list
 * posts, purge the cache), described once with every fact a surface needs. The
 * CLI, the agent doors and the generated reference all read these
 * declarations, so none of them keeps its own copy of a name, a schema or a
 * risk.
 *
 * A declaration states facts and runs nothing. Which of them must agree with
 * each other (a writer offers a dry run, an input only raises a level) is
 * checked when the list is assembled, in `start-up-checks.ts`.
 *
 * @module operations/definition
 * @experimental
 */
import type { SchemaInput, SchemaOutput, StandardSchema } from "./standard-schema";

/**
 * How much harm a run can do, lowest first. The approval rules turn a level
 * into "run", "ask in the chat" or "wait for the approval page"; the list only
 * states it.
 *
 * - `read`: changes nothing.
 * - `draft`: creates or changes only drafts, uploads or other work nobody else
 *   sees yet.
 * - `change`: changes what others see or what the site does, and undo can put
 *   it back.
 * - `critical`: undo can't put it back, or it reaches other people.
 */
export const RISK_LEVELS = ["read", "draft", "change", "critical"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Where an operation may run.
 *
 * - `local`: the CLI on the person's machine, against a database on that
 *   machine.
 * - `deploy`: the CLI in a deploy pipeline, acting as the deployment; only
 *   operations that bring the database's schema up to the code, or check that
 *   it is.
 * - `site`: the site's command door, reached from the CLI with a saved site.
 * - `chat`: the door chat apps use, for operations also marked `chatExposed`.
 */
export const DOORS = ["local", "deploy", "site", "chat"] as const;

export type Door = (typeof DOORS)[number];

/**
 * What a run does besides its level, each a separate fact: the agent doors
 * turn them into hints (a delete into the trash is `change` and `destroys`; a
 * mass email destroys nothing and is `critical` and `outside`).
 */
export interface OperationEffects {
  /** Removes or overwrites data that exists. */
  readonly destroys: boolean;
  /** Running it twice with the same input changes nothing more. */
  readonly idempotent: boolean;
  /** Reaches outside the site: email, webhooks, outside addresses. */
  readonly outside: boolean;
  /** Spends the site's AI budget. */
  readonly spendsAi: boolean;
}

/**
 * What a run needs from the person it acts as, or why it needs nothing.
 *
 * - `permission`: a stored permission, spelled as stored (`read-posts`).
 * - `project`: changes only files in the project on the person's machine and
 *   reads or changes no site data, so there is no one to check.
 * - `maintenance`: brings the schema up to the code, or repairs it, on the
 *   person's machine or in a deploy.
 * - `own-data`: a plugin's operation that reads only that plugin's own data.
 *
 * The three without a permission each carry the reason, so a reader of the
 * list sees why nothing is checked.
 */
export type OperationPermission =
  | { readonly kind: "permission"; readonly name: string }
  | {
      readonly kind: "project" | "maintenance" | "own-data";
      readonly reason: string;
    };

/**
 * An old name an operation still answers to: its command words, the release
 * that added the alias and the earliest release that may remove it.
 */
export interface OperationAlias {
  readonly command: readonly string[];
  readonly addedIn: string;
  readonly removableFrom: string;
}

/** One way to call an operation, which must parse against its input schema. */
export interface OperationExample<Input> {
  readonly summary: string;
  readonly input: Input;
}

/**
 * An exit code an operation may end with beyond the ones every command shares,
 * with what it means for this operation.
 */
export interface OperationExitCode {
  readonly code: number;
  readonly meaning: string;
}

/**
 * The exit codes every command shares, which an operation never redefines.
 * 2 is shared too (refused until something named is fixed), and an operation
 * may still declare what its own 2 means (a check that found differences).
 */
export const SHARED_EXIT_CODES: Readonly<Record<number, string>> = {
  0: "done, or nothing to do",
  1: "could not run",
  2: "out of step, or refused until something named is fixed or allowed",
  4: "stopped by the start-up probe",
  5: "waiting for a person's approval",
  130: "interrupted",
};

/** Where an operation comes from: core, or a plugin by its package name. */
export type OperationSource =
  | { readonly kind: "core" }
  | { readonly kind: "plugin"; readonly name: string };

/**
 * What a level-raising rule reads: the parsed input, and the target as the
 * plan found it (an entry's state, a setting's key), which the plan supplies
 * before anything changes.
 */
export interface OperationRun<Input> {
  readonly input: Input;
  readonly target?: Readonly<Record<string, unknown>>;
}

/**
 * A case in which a run is riskier than the operation's declared level: an
 * update of more entries than the bulk threshold, a published entry, a
 * security setting. A rule may only raise; one naming a lower level than the
 * operation's is refused when the list is assembled.
 */
export interface OperationRaise<Input> {
  /** Says in words when the rule applies, for the list's readers. */
  readonly when: string;
  readonly level: RiskLevel;
  /** Set to `false` when the raised run may never be covered by "Always allow". */
  readonly alwaysAllow?: false;
  /**
   * Whether this run is such a case. Declared as a method so a list can hold
   * operations whose inputs differ.
   */
  applies(run: OperationRun<Input>): boolean;
}

/**
 * One operation, as its owner declares it. Every field without a `?` is
 * required, so a declaration that leaves one out does not compile.
 */
export interface OperationDefinition<
  In extends StandardSchema = StandardSchema,
  Out extends StandardSchema = StandardSchema,
> {
  /** Stable and never reused: dotted, `<noun>.<verb>` (`migrations.create`). */
  readonly id: string;
  /** The words after `nextly` that run it: `["migrations", "create"]`. */
  readonly command: readonly string[];
  /** Old command words it still answers to; empty when it has none. */
  readonly aliases: readonly OperationAlias[];
  /** One line, for help and lists. */
  readonly summary: string;
  /** For agents: what it does, what it never does, what to call first. */
  readonly description: string;
  readonly input: In;
  /** The shape of the run's result. */
  readonly output: Out;
  readonly level: RiskLevel;
  /**
   * Set to `false` on a `critical` operation that may never be covered by
   * "Always allow": more rights for an agent or key, security or sign-in
   * settings, deleting the activity log.
   */
  readonly alwaysAllow?: false;
  /** The cases that raise this run's level above `level`. */
  readonly raise?: readonly OperationRaise<SchemaOutput<In>>[];
  readonly effects: OperationEffects;
  readonly doors: readonly Door[];
  /**
   * Whether chat apps may see it; off unless set. It does not by itself let a
   * chat app run anything: the owner's switches and the person's grant still
   * decide that.
   */
  readonly chatExposed?: boolean;
  readonly permission: OperationPermission;
  /** Whether `--dry-run` returns the run's plan without changing anything. */
  readonly dryRun: boolean;
  /** Whether it runs in the background with an ID to check or cancel. */
  readonly long: boolean;
  /** At least one. */
  readonly examples: readonly [
    OperationExample<SchemaInput<In>>,
    ...OperationExample<SchemaInput<In>>[],
  ];
  /** The codes beyond the shared ones; empty when it adds none. */
  readonly exitCodes: readonly OperationExitCode[];
  readonly source: OperationSource;
  readonly stability: "experimental" | "stable";
  /** An agent tool name that replaces the derived one, for names already in use. */
  readonly toolName?: string;
  /** A link to its section of the reference. */
  readonly docs?: string;
}

/**
 * Declares an operation. It returns the declaration unchanged: its job is to
 * infer the input and output types from the schemas, so the examples and the
 * raise rules are checked against them.
 */
export function defineOperation<
  In extends StandardSchema,
  Out extends StandardSchema,
>(definition: OperationDefinition<In, Out>): OperationDefinition<In, Out> {
  return definition;
}
