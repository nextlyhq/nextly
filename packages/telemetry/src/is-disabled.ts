import { detectIsCi } from "./environment.js";

export type DisabledReason =
  | "DO_NOT_TRACK"
  | "env-var"
  | "production"
  | "ci"
  | "docker"
  | "non-tty"
  | "config";

export interface DisabledResult {
  disabled: boolean;
  reason: DisabledReason | null;
}

export interface ResolveDisabledInput {
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  isDocker: boolean;
  enabledInConfig: boolean;
}

// Order matters: first hit wins. DO_NOT_TRACK outranks everything else so
// that a user who has set it globally on their machine cannot be overridden
// by any other signal.
export function resolveDisabled(input: ResolveDisabledInput): DisabledResult {
  const { env, isTty, isDocker, enabledInConfig } = input;

  if (env.DO_NOT_TRACK === "1")
    return { disabled: true, reason: "DO_NOT_TRACK" };
  if (env.NEXTLY_TELEMETRY_DISABLED === "1")
    return { disabled: true, reason: "env-var" };
  if (env.NODE_ENV === "production")
    return { disabled: true, reason: "production" };
  if (detectIsCi(env)) return { disabled: true, reason: "ci" };
  if (isDocker) return { disabled: true, reason: "docker" };
  if (!isTty) return { disabled: true, reason: "non-tty" };
  if (!enabledInConfig) return { disabled: true, reason: "config" };

  return { disabled: false, reason: null };
}
