/**
 * What the adapter reads from an operation, and how it asks for one to run.
 *
 * These types are a strict subset of core's operation definition, written out
 * here because core does not export its definition yet. A list core assembles
 * satisfies them as it is, so moving to core's own exported types later
 * changes the import and nothing else.
 *
 * @module operation
 * @experimental
 */

/** How much harm a run can do, lowest first: core's four risk levels. */
export type RiskLevel = "read" | "draft" | "change" | "critical";

/** Where an operation may run: core's four doors. */
export type Door = "local" | "deploy" | "site" | "chat";

/** What a run does besides its level, each a separate fact. */
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
 * An old tool name an operation still answers to, with the release that
 * renamed it and the earliest release that may stop accepting it.
 */
export interface ToolNameAlias {
  readonly name: string;
  readonly addedIn: string;
  readonly removableFrom: string;
}

/** What a Standard Schema's `validate` answers. */
export type SchemaResult =
  | { readonly value: unknown; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<
          PropertyKey | { readonly key: PropertyKey }
        >;
      }>;
    };

/**
 * A Standard Schema (version 1) that can also describe itself as JSON Schema
 * (`~standard.jsonSchema`, which Zod has carried since 4.2). The adapter
 * needs both: the JSON Schema for the tool's definition, `validate` for each
 * call.
 */
export interface DescribedSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => SchemaResult | Promise<SchemaResult>;
    readonly jsonSchema?: {
      readonly input: (options: {
        readonly target: string;
      }) => Record<string, unknown>;
      readonly output: (options: {
        readonly target: string;
      }) => Record<string, unknown>;
    };
  };
}

/** One operation, as much of it as the adapter reads. */
export interface AgentOperation {
  /** Stable and never reused: dotted, `<noun>.<verb>`. */
  readonly id: string;
  /** One line; the tool's title. */
  readonly summary: string;
  /** For agents: what it does, what it never does, what to call first. */
  readonly description: string;
  readonly input: DescribedSchema;
  readonly output: DescribedSchema;
  readonly level: RiskLevel;
  readonly effects: OperationEffects;
  readonly doors: readonly Door[];
  /** Whether chat apps may see it. */
  readonly chatExposed: boolean;
  /** Old tool names it still answers to, unlisted. */
  readonly toolNameAliases?: readonly ToolNameAlias[];
}

/**
 * Where a list stands after a page: the operation's own cursor for the next
 * page (`null` on the last), the page size used, and optionally the total
 * and whether a size cap cut the page short.
 */
export interface OperationPage {
  readonly next: string | null;
  readonly limit: number;
  readonly total?: number;
  readonly truncated?: boolean;
}

/** What one run gives back: its result, and for a list, its page. */
export interface OperationOutcome {
  readonly result: unknown;
  readonly page?: OperationPage;
}

/**
 * The operations a door serves, and the one way to run them. `toolNameOf`
 * is the operation list's forward name map; `run` is the operation engine,
 * which checks the caller's permission and records the run.
 */
export interface OperationSource<Caller> {
  readonly operations: readonly AgentOperation[];
  toolNameOf(operation: AgentOperation): string;
  run(
    operation: AgentOperation,
    input: unknown,
    caller: Caller
  ): Promise<OperationOutcome>;
}
