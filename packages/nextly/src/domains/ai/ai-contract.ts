/**
 * The AI contract: what core asks of the package that provides AI, and the
 * shapes core and that package exchange.
 *
 * A leaf on purpose, like the page-metadata contract. It holds the names a
 * provider declares, the shapes it answers with and the three permissions,
 * and imports nothing, so boot validation, the Direct API, the status route
 * and the permission seeding read one spelling of each name.
 *
 * Core holds no provider code, model names or keys. A package provides AI by
 * declaring the capability and contributing the service under its name:
 *
 * ```ts
 * definePlugin({
 *   provides: ["ai"],
 *   contributes: { services: { ai: () => provider } },
 * });
 * ```
 *
 * One plugin at most provides it: boot refuses a capability provided twice.
 *
 * @experimental The contract settles as the first AI feature exercises it.
 * @module domains/ai/ai-contract
 */

/** The capability an AI provider declares in `provides`. */
export const AI_CAPABILITY = "ai";

/** The `contributes.services` key the provider is registered under. */
export const AI_SERVICE = "ai";

/**
 * The deploy-time lock that turns AI off for a site: `NEXTLY_AI=off` in the
 * environment where it is deployed. Nothing in the admin undoes it, and the
 * AI settings are kept as they were.
 */
export const AI_LOCK_VARIABLE = "NEXTLY_AI";

/** The {@link AI_LOCK_VARIABLE} value that turns AI off. */
export const AI_LOCK_OFF = "off";

/**
 * @experimental The kinds of model a task may ask for. A task names a role,
 * never a model; the owner maps each role to a model in the provider.
 */
export const AI_MODEL_ROLES = [
  "fast",
  "writer",
  "vision",
  "embedding",
  "image",
] as const;

/** @experimental One of {@link AI_MODEL_ROLES}. */
export type AIModelRole = (typeof AI_MODEL_ROLES)[number];

/**
 * @experimental The three things a person may be allowed to do with AI: use
 * it on content they may edit, run bulk jobs, and manage its settings. Core
 * names no permission for them: the package that provides AI registers its
 * own and says which one stands for each ({@link AIProvider.permissions}).
 */
const AI_PERMISSION_KEYS = ["use", "bulk", "manage"] as const;

/** @experimental One of {@link AI_PERMISSION_KEYS}. */
export type AIPermissionKey = (typeof AI_PERMISSION_KEYS)[number];

/** @experimental A permission as stored: an action on a resource. */
export interface AIPermissionRef {
  action: string;
  resource: string;
}

/**
 * @experimental A task as core knows it: enough to say who may run it and
 * which model role it needs. The full declaration (shapes, instructions,
 * fields read) belongs to the task registry the plugin SDK fills.
 */
export interface AITaskRef {
  /** The package or plugin that registered the task. */
  owner: string;
  /** The task's name, unique within its owner. */
  name: string;
  /** The model role the task asks for. */
  role: AIModelRole;
  /**
   * Whether the task's result is written where it points (a draft or a
   * suggestion on the target), so running it needs the right to edit there.
   * A task whose result goes back to the caller only needs to read.
   */
  writesToTarget: boolean;
}

/**
 * @experimental The content a run reads and writes back to: a collection or
 * a Single, by slug. The caller must be allowed to read it, and to edit it
 * when the task writes its result there.
 */
export interface AIRunTarget {
  collection: string;
  /** The entry, when the run is about one. */
  id?: string;
}

/** @experimental An agent acting for the person, recorded with the run. */
export interface AIAgent {
  /** The agent's stable id. */
  id: string;
  /** A display name for the agent, such as the client it signed in from. */
  name?: string | null;
}

/** @experimental What the provider says about its own setup. */
export interface AIProviderStatus {
  /** For each role, whether the owner has mapped it to a model. */
  roles: Partial<Record<AIModelRole, boolean>>;
}

/** @experimental What one run used, as the provider measured it. */
export interface AIRunUsage {
  /** The model that answered, as the provider names it. */
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  /**
   * The estimated cost in millionths of a US dollar, a whole number, or null
   * where the model has no price. Never a float: sums stay exact.
   */
  estimatedCostMicroUsd: number | null;
}

/** @experimental What core hands the provider for one run. */
export interface AIProviderRunRequest {
  task: AITaskRef;
  input: unknown;
  target: AIRunTarget | null;
  /** The person the run acts for, or null for trusted server code. */
  personId: string | null;
  agent: AIAgent | null;
}

/** @experimental A finished run: the task's checked output and its usage. */
export interface AIProviderRunOutcome {
  output: unknown;
  usage: AIRunUsage;
}

/** @experimental A streamed run: its text as it comes, then its usage. */
export interface AIProviderStream {
  text: AsyncIterable<string>;
  /**
   * Settles once the text has ended, or once core has stopped it because
   * the reader stopped early, with what was used up to then. Core waits a
   * few seconds for it after a stop, then records the run with no usage.
   */
  usage: Promise<AIRunUsage>;
}

/** @experimental What core hands the provider to embed text. */
export interface AIProviderEmbedRequest {
  texts: readonly string[];
  personId: string | null;
  agent: AIAgent | null;
}

/** @experimental Embedded text: one vector per text, in order. */
export interface AIProviderEmbedOutcome {
  vectors: number[][];
  usage: AIRunUsage;
}

/**
 * @experimental The service an AI provider contributes under
 * {@link AI_SERVICE}. Core has checked the caller before calling any of it.
 */
export interface AIProvider {
  /**
   * Which of the provider's own permissions stands for each of the three, so
   * core asks its one access decision with them. The provider registers
   * them; core never names one.
   */
  readonly permissions: Readonly<Record<AIPermissionKey, AIPermissionRef>>;
  status(): AIProviderStatus | Promise<AIProviderStatus>;
  run(request: AIProviderRunRequest): Promise<AIProviderRunOutcome>;
  stream(request: AIProviderRunRequest): Promise<AIProviderStream>;
  embed(request: AIProviderEmbedRequest): Promise<AIProviderEmbedOutcome>;
}

/**
 * @experimental Why AI is not configured: no package provides it, or the
 * site's environment turned it off.
 */
export type AINotConfiguredReason = "no-ai-package" | "turned-off";

/**
 * @experimental Why a task is not available to a caller. `not-configured`
 * covers both reasons AI as a whole is unavailable.
 */
export type AITaskUnavailableReason =
  | "not-configured"
  | "no-model-for-role"
  | "missing-permission";

/** @experimental One task, and whether this caller may run it. */
export interface AITaskStatus {
  owner: string;
  name: string;
  role: AIModelRole;
  available: boolean;
  /** Present when the task is not available. */
  reason?: AITaskUnavailableReason;
  /** The permission the caller lacks, when that is the reason. */
  permission?: string;
}

/** @experimental The answer to "is AI here, and what may I do with it?". */
export interface AIStatus {
  configured: boolean;
  /** Present when AI is not configured. */
  reason?: AINotConfiguredReason;
  /** For each role, whether it has a model; all false when not configured. */
  roles: Record<AIModelRole, boolean>;
  /** Which of the three permissions the caller holds. */
  permissions: Record<AIPermissionKey, boolean>;
  /** Every registered task, and whether this caller may run it. */
  tasks: AITaskStatus[];
}

/** @experimental How a run ended. */
export type AIRunResult = "succeeded" | "failed" | "refused" | "cancelled";

/**
 * @experimental The one event every run emits when it ends, whatever its
 * result. Carries no content: what was sent and what came back stay out.
 */
export interface AIUsageEvent {
  kind: "run" | "stream" | "embed";
  /** The task, or null for an embedding. */
  task: { owner: string; name: string } | null;
  /** The model that answered, or null when none was reached. */
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  estimatedCostMicroUsd: number | null;
  /** The person the run acted for, or null for trusted server code. */
  personId: string | null;
  agent: AIAgent | null;
  result: AIRunResult;
  /** When the run ended. */
  endedAt: Date;
}

/** @experimental A listener for {@link AIUsageEvent}. */
export type AIUsageListener = (event: AIUsageEvent) => void | Promise<void>;
