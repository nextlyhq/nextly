/**
 * Core's AI service: run a task, stream a task's text, embed text, report
 * status, and check who may start a bulk job.
 *
 * Holds no provider code, model names or keys. It answers the questions core
 * owns (is AI here, may this person use it on this content, does the task's
 * role have a model) and hands the rest to the package that provides the "ai"
 * capability. Every run that core admits or refuses ends in one usage event.
 *
 * Built over its dependencies so its decisions are tested without a database;
 * {@link aiService} wires the real ones.
 *
 * @module domains/ai/ai-service
 */
import type { AuthContext } from "../../auth/middleware";
import { NextlyError } from "../../errors/nextly-error";

import {
  AI_MODEL_ROLES,
  AI_OFF_SWITCH,
  AI_PERMISSIONS,
  type AIAgent,
  type AIModelRole,
  type AINotConfiguredReason,
  type AIPermissionKey,
  type AIProvider,
  type AIProviderRunRequest,
  type AIProviderStream,
  type AIRunResult,
  type AIRunTarget,
  type AIRunUsage,
  type AIStatus,
  type AITaskRef,
  type AITaskStatus,
  type AIUsageEvent,
} from "./ai-contract";

/**
 * Who a call is made as: the checked caller, or `null` for trusted server
 * code, which every check lets through.
 */
export type AICaller = AuthContext | null;

/** What the service reads from the rest of core. */
export interface AIServiceDeps {
  /** The started "ai" provider, or undefined when none provides it. */
  provider(): AIProvider | undefined;
  /** Whether the site's environment turns AI off. */
  turnedOff(): boolean;
  /** The registered tasks. */
  tasks(): readonly AITaskRef[];
  /** Whether the caller holds one permission, judged on the grant alone. */
  holds(
    caller: AuthContext,
    permission: { action: string; resource: string }
  ): Promise<boolean>;
  /**
   * Refuse a caller who lacks one permission, judged as {@link holds} judges
   * it, with core's own refusal: worded for a person ("You can't use AI.")
   * and recorded as every refusal is. Resolves when they hold it.
   */
  requirePermission(
    caller: AuthContext,
    permission: { action: string; resource: string }
  ): Promise<void>;
  /**
   * Refuse, as the content routes refuse, a caller who may not `action` the
   * target; resolves when they may.
   */
  authorizeTarget(
    caller: AuthContext,
    action: "read" | "update",
    target: AIRunTarget
  ): Promise<void>;
  /** Tell the usage listeners about one run. */
  emit(event: AIUsageEvent): Promise<void>;
  now(): Date;
}

/** A task named by its owner and name. */
export interface AITaskName {
  owner: string;
  name: string;
}

/** What a run or a stream is asked to do. */
export interface AIRunArgs {
  task: AITaskName;
  input: unknown;
  target?: AIRunTarget | null;
  agent?: AIAgent | null;
}

/** What an embedding is asked to do. */
export interface AIEmbedArgs {
  texts: readonly string[];
  agent?: AIAgent | null;
}

/** @experimental A finished run: the task's checked output and its usage. */
export interface AIRunOutput {
  output: unknown;
  usage: AIRunUsage;
}

/** @experimental Embedded text, one vector per text, and the usage. */
export interface AIEmbedOutput {
  vectors: number[][];
  usage: AIRunUsage;
}

/** What core's AI service offers. */
export interface AIService {
  status(caller: AICaller): Promise<AIStatus>;
  run(caller: AICaller, args: AIRunArgs): Promise<AIRunOutput>;
  stream(caller: AICaller, args: AIRunArgs): Promise<AsyncIterable<string>>;
  embed(caller: AICaller, args: AIEmbedArgs): Promise<AIEmbedOutput>;
  /** Refuse a caller who may not start, cancel or resume a bulk job. */
  checkBulkJob(caller: AICaller): Promise<void>;
}

const NO_USAGE: AIRunUsage = {
  model: null,
  tokensIn: 0,
  tokensOut: 0,
  estimatedCostMicroUsd: null,
};

/** Every role, none with a model: the answer while AI is not configured. */
function noRoles(): Record<AIModelRole, boolean> {
  return Object.fromEntries(
    AI_MODEL_ROLES.map(role => [role, false])
  ) as Record<AIModelRole, boolean>;
}

/**
 * The refusal while AI is not configured. Names what to do, since waiting
 * will not change it.
 */
function notConfiguredError(reason: AINotConfiguredReason): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage:
      reason === "turned-off"
        ? `AI is turned off on this site by ${AI_OFF_SWITCH}. Unset it to turn AI back on; its settings are kept.`
        : "AI isn't set up on this site. Add @nextlyhq/ai to the plugins in your Nextly config, or run `nextly ai setup`.",
    logContext: { reason: `ai-${reason}` },
  });
}

/** The refusal for a task whose role has no model. */
function noModelError(task: AITaskRef): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: `The AI task "${task.owner}/${task.name}" needs a model for the "${task.role}" role, and none is set. Choose one in the AI settings.`,
    logContext: { reason: "ai-no-model-for-role", role: task.role },
  });
}

/** What the provider is handed for one admitted task run. */
function providerRequest(
  caller: AICaller,
  args: AIRunArgs,
  task: AITaskRef
): AIProviderRunRequest {
  return {
    task,
    input: args.input,
    target: args.target ?? null,
    personId: caller?.userId ?? null,
    agent: args.agent ?? null,
  };
}

/**
 * How long a stopped or broken stream's usage is waited for. The provider
 * settles it once its text has ended or been stopped; one that never does
 * must not hold the reader that stopped it.
 */
export const STREAM_USAGE_WAIT_MS = 5_000;

/** What a stream reported it used, or none if it fails or takes too long. */
async function usageWithin(usage: Promise<AIRunUsage>): Promise<AIRunUsage> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AIRunUsage>(resolve => {
    timer = setTimeout(() => resolve(NO_USAGE), STREAM_USAGE_WAIT_MS);
  });
  try {
    return await Promise.race([usage.catch(() => NO_USAGE), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAIService(deps: AIServiceDeps): AIService {
  /** Why AI is not configured, or undefined when it is. */
  function notConfigured(): AINotConfiguredReason | undefined {
    if (deps.turnedOff()) return "turned-off";
    return deps.provider() === undefined ? "no-ai-package" : undefined;
  }

  /** The started provider, refusing while AI is not configured. */
  function requireProvider(): AIProvider {
    const reason = notConfigured();
    if (reason !== undefined) throw notConfiguredError(reason);
    // Checked just above: not configured is the only way to have none.
    const provider = deps.provider();
    if (provider === undefined) throw notConfiguredError("no-ai-package");
    return provider;
  }

  async function holds(
    caller: AICaller,
    key: AIPermissionKey
  ): Promise<boolean> {
    return caller === null || deps.holds(caller, AI_PERMISSIONS[key]);
  }

  async function requirePermission(
    caller: AICaller,
    key: AIPermissionKey
  ): Promise<void> {
    if (caller !== null) {
      await deps.requirePermission(caller, AI_PERMISSIONS[key]);
    }
  }

  async function rolesWithModels(
    provider: AIProvider
  ): Promise<Record<AIModelRole, boolean>> {
    const { roles } = await provider.status();
    const answer = noRoles();
    for (const role of AI_MODEL_ROLES) answer[role] = roles[role] === true;
    return answer;
  }

  function findTask(name: AITaskName): AITaskRef {
    const task = deps
      .tasks()
      .find(t => t.owner === name.owner && t.name === name.name);
    if (task === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "ai-task-unknown", task: name },
      });
    }
    return task;
  }

  /**
   * Every check a task run passes before the provider is asked, in order:
   * AI is here, the caller may use it, may read the target and edit it where
   * the result is written, and the task's role has a model. Preconditions,
   * so all of them run before any work.
   */
  async function admitTask(
    caller: AICaller,
    args: AIRunArgs
  ): Promise<{ provider: AIProvider; task: AITaskRef }> {
    const provider = requireProvider();
    const task = findTask(args.task);
    await requirePermission(caller, "use");
    const target = args.target ?? null;
    if (caller !== null && target !== null) {
      await deps.authorizeTarget(caller, "read", target);
      if (task.writesToTarget) {
        await deps.authorizeTarget(caller, "update", target);
      }
    }
    if (!(await rolesWithModels(provider))[task.role]) throw noModelError(task);
    return { provider, task };
  }

  /** The one usage event for a run that ended. */
  function emitEnd(
    kind: AIUsageEvent["kind"],
    caller: AICaller,
    task: AITaskName | null,
    agent: AIAgent | null | undefined,
    usage: AIRunUsage,
    result: AIRunResult
  ): Promise<void> {
    return deps.emit({
      kind,
      task: task === null ? null : { owner: task.owner, name: task.name },
      ...usage,
      personId: caller?.userId ?? null,
      agent: agent ?? null,
      result,
      endedAt: deps.now(),
    });
  }

  /**
   * Admit the run, then do it, emitting one event when it ends however it
   * ends: refused when `admit` throws (core's checks said no), failed when
   * `work` throws (the provider did), succeeded otherwise. The error is
   * rethrown as it came.
   */
  async function withUsageEvent<A, T extends { usage: AIRunUsage }>(
    kind: AIUsageEvent["kind"],
    caller: AICaller,
    task: AITaskName | null,
    agent: AIAgent | null | undefined,
    admit: () => Promise<A>,
    work: (admitted: A) => Promise<T>
  ): Promise<T> {
    let admitted: A;
    try {
      admitted = await admit();
    } catch (error) {
      await emitEnd(kind, caller, task, agent, NO_USAGE, "refused");
      throw error;
    }
    let outcome: T;
    try {
      outcome = await work(admitted);
    } catch (error) {
      await emitEnd(kind, caller, task, agent, NO_USAGE, "failed");
      throw error;
    }
    await emitEnd(kind, caller, task, agent, outcome.usage, "succeeded");
    return outcome;
  }

  /**
   * The provider's text, passed through as it comes, with the run's one
   * event emitted when the reading ends, however it ends: succeeded once the
   * text has all been read and its usage reported; failed when the text or
   * its usage breaks; cancelled when the reader stops, before or during the
   * reading, after the provider has been told to stop and has said what it
   * used (waited for at most {@link STREAM_USAGE_WAIT_MS}). Written by hand
   * rather than as a generator, because a generator stopped before its first
   * read never runs its cleanup, and its event would be lost.
   *
   * A stream nobody reads or stops never ends, so it emits nothing.
   */
  function streamed(
    caller: AICaller,
    args: AIRunArgs,
    stream: AIProviderStream
  ): AsyncIterable<string> {
    const source = stream.text[Symbol.asyncIterator]();
    let ended = false;
    const end = async (result: AIRunResult, usage: AIRunUsage) => {
      ended = true;
      await emitEnd("stream", caller, args.task, args.agent, usage, result);
    };
    const finished = { done: true as const, value: undefined };
    const iterator: AsyncIterator<string> = {
      async next() {
        if (ended) return finished;
        let step: IteratorResult<string>;
        try {
          step = await source.next();
        } catch (error) {
          await end("failed", await usageWithin(stream.usage));
          throw error;
        }
        if (!step.done) return { done: false, value: step.value };
        let usage: AIRunUsage;
        try {
          usage = await stream.usage;
        } catch (error) {
          await end("failed", NO_USAGE);
          throw error;
        }
        await end("succeeded", usage);
        return finished;
      },
      async return() {
        if (ended) return finished;
        ended = true;
        try {
          await source.return?.();
        } finally {
          await emitEnd(
            "stream",
            caller,
            args.task,
            args.agent,
            await usageWithin(stream.usage),
            "cancelled"
          );
        }
        return finished;
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }

  return {
    async status(caller) {
      const reason = notConfigured();
      // Not resolved at all while AI is off or absent: resolving runs the
      // provider's factory, and a broken provider must not fail the status.
      const provider = reason === undefined ? deps.provider() : undefined;
      const roles =
        reason === undefined && provider !== undefined
          ? await rolesWithModels(provider)
          : noRoles();
      const permissions = {
        use: await holds(caller, "use"),
        bulk: await holds(caller, "bulk"),
        manage: await holds(caller, "manage"),
      };
      const tasks = deps.tasks().map((task): AITaskStatus => {
        const base = { owner: task.owner, name: task.name, role: task.role };
        if (reason !== undefined) {
          return { ...base, available: false, reason: "not-configured" };
        }
        if (!permissions.use) {
          return {
            ...base,
            available: false,
            reason: "missing-permission",
            permission: AI_PERMISSIONS.use.slug,
          };
        }
        if (!roles[task.role]) {
          return { ...base, available: false, reason: "no-model-for-role" };
        }
        return { ...base, available: true };
      });
      return {
        configured: reason === undefined,
        ...(reason === undefined ? {} : { reason }),
        roles,
        permissions,
        tasks,
      };
    },

    run(caller, args) {
      return withUsageEvent(
        "run",
        caller,
        args.task,
        args.agent,
        () => admitTask(caller, args),
        ({ provider, task }) =>
          provider.run(providerRequest(caller, args, task))
      );
    },

    async stream(caller, args) {
      let admitted: { provider: AIProvider; task: AITaskRef };
      try {
        admitted = await admitTask(caller, args);
      } catch (error) {
        await emitEnd(
          "stream",
          caller,
          args.task,
          args.agent,
          NO_USAGE,
          "refused"
        );
        throw error;
      }
      let stream: AIProviderStream;
      try {
        stream = await admitted.provider.stream(
          providerRequest(caller, args, admitted.task)
        );
      } catch (error) {
        await emitEnd(
          "stream",
          caller,
          args.task,
          args.agent,
          NO_USAGE,
          "failed"
        );
        throw error;
      }
      return streamed(caller, args, stream);
    },

    embed(caller, args) {
      return withUsageEvent(
        "embed",
        caller,
        null,
        args.agent,
        async () => {
          const provider = requireProvider();
          await requirePermission(caller, "use");
          if (!(await rolesWithModels(provider)).embedding) {
            throw NextlyError.serviceUnavailable({
              publicMessage:
                'Embedding text needs a model for the "embedding" role, and none is set. Choose one in the AI settings.',
              logContext: { reason: "ai-no-model-for-role", role: "embedding" },
            });
          }
          return provider;
        },
        provider =>
          provider.embed({
            texts: args.texts,
            personId: caller?.userId ?? null,
            agent: args.agent ?? null,
          })
      );
    },

    async checkBulkJob(caller) {
      requireProvider();
      await requirePermission(caller, "use");
      await requirePermission(caller, "bulk");
    },
  };
}
