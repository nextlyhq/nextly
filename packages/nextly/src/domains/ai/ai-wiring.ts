/**
 * Core's AI service over the real process: the provider boot recorded, the
 * environment switch, the recorded tasks, and the access decision the REST
 * routes ask, so one caller gets one answer through either door.
 *
 * @module domains/ai/ai-wiring
 */
import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
} from "../../auth/middleware";
import { toNextlyAuthError } from "../../auth/middleware/to-nextly-error";
import { NextlyError } from "../../errors/nextly-error";
import { capabilityProvider } from "../../plugins/capabilities";
import { buildPluginServicesNamespace } from "../../plugins/services/plugin-services-registry";

import { AI_CAPABILITY, AI_SERVICE, type AIProvider } from "./ai-contract";
import { createAIService, type AIService } from "./ai-service";
import { aiTurnedOff } from "./ai-switch";
import { recordedAITasks } from "./ai-task-list";
import { emitAIUsage } from "./ai-usage-events";

/** True for a value shaped like a provider: the four calls core makes. */
function isAIProvider(value: unknown): value is AIProvider {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ["status", "run", "stream", "embed"].every(
    name => typeof candidate[name] === "function"
  );
}

/**
 * The started "ai" provider, or undefined when no plugin provides it.
 *
 * Read from the provider record boot keeps, never from the configuration, so
 * a plugin that did not start is never asked.
 *
 * @throws NextlyError when the provider's service is not a provider.
 */
function startedProvider(): AIProvider | undefined {
  const plugin = capabilityProvider(AI_CAPABILITY);
  if (plugin === undefined) return undefined;
  const service = buildPluginServicesNamespace()[plugin]?.[AI_SERVICE];
  if (!isAIProvider(service)) {
    throw NextlyError.internal({
      logContext: {
        plugin,
        reason: `"${AI_SERVICE}" service lacks status, run, stream or embed`,
      },
    });
  }
  return service;
}

let service: AIService | undefined;

/** Core's AI service, built once per module evaluation over the real process. */
export function aiService(): AIService {
  service ??= createAIService({
    provider: startedProvider,
    turnedOff: () => aiTurnedOff(),
    tasks: recordedAITasks,
    // The grant alone, as the any-of gates ask: the three AI permissions sit
    // on system resources, which no entity's access rule speaks for.
    holds: async (caller, permission) =>
      !isErrorResponse(await authorizeCallerForAny(caller, [permission])),
    // The same question, answered with the refusal REST gives: named for the
    // permission's one resource, so it reads "You can't use AI.".
    requirePermission: async (caller, permission) => {
      const decision = await authorizeCallerForAny(caller, [permission]);
      if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
    },
    // The content routes' own decision, so a caller naming one entry it may
    // not read is answered as if it were missing, exactly as REST answers.
    authorizeTarget: async (caller, action, target) => {
      const decision = await authorizeCaller(
        caller,
        action,
        target.collection,
        target.id === undefined ? "all" : "one"
      );
      if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
    },
    emit: emitAIUsage,
    now: () => new Date(),
  });
  return service;
}
