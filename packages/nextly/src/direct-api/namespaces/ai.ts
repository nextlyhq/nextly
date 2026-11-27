/**
 * Direct API `nextly.ai.*`: run an AI task, stream its text, embed text,
 * report what AI can do here, and hear about every run's usage.
 *
 * Thin over core's AI service, which owns every decision; this adds who the
 * call acts as.
 *
 * ## Checked by default
 *
 * Unlike the rest of the Direct API, these calls are checked unless the call
 * itself says `overrideAccess: true`: an AI run sends content to an outside
 * service and spends the site's money, so code that forgets to name a person
 * must be refused rather than trusted. The instance's own `overrideAccess`
 * default does not reach here; only an explicit `true` on the call does.
 *
 * @experimental The contract settles as the first AI feature exercises it.
 * @module direct-api/namespaces/ai
 */
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type {
  AIAgent,
  AIStatus,
  AITaskStatus,
  AIUsageListener,
} from "../../domains/ai/ai-contract";
import type {
  AICaller,
  AIEmbedArgs,
  AIEmbedOutput,
  AIRunArgs,
  AIRunOutput,
} from "../../domains/ai/ai-service";
import { onAIUsage } from "../../domains/ai/ai-usage-events";
import { aiService } from "../../domains/ai/ai-wiring";
import type { UserContext } from "../types/shared";

import type { NextlyContext } from "./context";
import { checkedCaller } from "./helpers";

/** @experimental Who an AI call acts as. */
export interface AICallerArgs {
  /** The person the call acts for. Required unless the call is trusted. */
  user?: UserContext;
  /**
   * `true` runs the call as trusted server code, with no permission checks.
   * Defaults to `false` here, whatever the instance's default.
   */
  overrideAccess?: boolean;
  /** The API key's own grants, when the transport authenticated one. */
  authenticatedScope?: AuthenticatedScope;
  /**
   * The agent acting for the person, recorded with the run. The checks are
   * the person's, never more.
   */
  agent?: AIAgent | null;
}

/** @experimental `nextly.ai.*`. */
export interface AINamespace {
  /** Whether AI is configured, which roles have a model, and what the caller may run. */
  status(args?: AICallerArgs): Promise<AIStatus>;
  /** Every registered task, and whether the caller may run it. */
  tasks(args?: AICallerArgs): Promise<AITaskStatus[]>;
  /** Run a task, returning its checked output and what it used. */
  run(args: Omit<AIRunArgs, "agent"> & AICallerArgs): Promise<AIRunOutput>;
  /** Run a task, returning its text as it comes. */
  stream(
    args: Omit<AIRunArgs, "agent"> & AICallerArgs
  ): Promise<AsyncIterable<string>>;
  /** Embed text: one vector per text, in order. */
  embed(args: Omit<AIEmbedArgs, "agent"> & AICallerArgs): Promise<AIEmbedOutput>;
  /**
   * Refuse a caller who may not start, cancel or resume a bulk AI job:
   * "Use AI" and "Run bulk AI jobs", both the person's own.
   */
  checkBulkJob(args?: AICallerArgs): Promise<void>;
  /**
   * Hear every AI run's usage event, inside this process. Returns the
   * function that stops it.
   */
  onUsage(listener: AIUsageListener): () => void;
}

export function createAINamespace(ctx: NextlyContext): AINamespace {
  /** The checked caller, or null for a call that asked to be trusted. */
  function callerOf(args: AICallerArgs = {}): AICaller {
    return checkedCaller(ctx.defaultConfig, {
      ...(args.user === undefined ? {} : { user: args.user }),
      ...(args.authenticatedScope === undefined
        ? {}
        : { authenticatedScope: args.authenticatedScope }),
      overrideAccess: args.overrideAccess === true,
    });
  }

  return {
    status: async args => aiService().status(callerOf(args)),
    tasks: async args => (await aiService().status(callerOf(args))).tasks,
    run: async args =>
      aiService().run(callerOf(args), {
        task: args.task,
        input: args.input,
        target: args.target ?? null,
        agent: args.agent ?? null,
      }),
    stream: async args =>
      aiService().stream(callerOf(args), {
        task: args.task,
        input: args.input,
        target: args.target ?? null,
        agent: args.agent ?? null,
      }),
    embed: async args =>
      aiService().embed(callerOf(args), {
        texts: args.texts,
        agent: args.agent ?? null,
      }),
    checkBulkJob: async args => aiService().checkBulkJob(callerOf(args)),
    onUsage: listener => onAIUsage(listener),
  };
}
