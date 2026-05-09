import { maybeShowBanner } from "./banner.js";
import { createTelemetryClient, type TelemetryClient } from "./client.js";
import { createConsentStore, type ConsentStore } from "./consent.js";
import { POSTHOG_TOKEN, TELEMETRY_ENDPOINT } from "./constants.js";
import { collectBaseContext, detectIsDocker } from "./environment.js";
import type {
  BaseContext,
  CliName,
  EventName,
  EventProperties,
} from "./events.js";
import { resolveDisabled, type DisabledResult } from "./is-disabled.js";
import { hashProjectId } from "./project-id.js";

export type {
  CliName,
  EventName,
  EventProperties,
  TelemetryEvent,
  ErrorCode,
} from "./events.js";
export type { ClassifyScope } from "./classify-error.js";
export { classifyError } from "./classify-error.js";
export type { DisabledResult, DisabledReason } from "./is-disabled.js";

interface InitOptions {
  cliName: CliName;
  cliVersion: string;
  /** For testing only. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** For testing only. Defaults to process.stdout.isTTY. */
  isTty?: boolean;
  /** For testing only. Overrides the conf storage dir. */
  cwdOverride?: string;
}

interface State {
  client: TelemetryClient | null;
  disabled: DisabledResult;
  baseContext: BaseContext;
  distinctId: string;
  salt: string;
  consent: ConsentStore;
  sessionId: string;
  cwd: string;
}

let state: State | null = null;

function randomSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function init(opts: InitOptions): Promise<void> {
  const env = opts.env ?? process.env;
  const isTty = opts.isTty ?? Boolean(process.stdout.isTTY);
  const isDocker = detectIsDocker();

  const consent = createConsentStore(
    opts.cwdOverride ? { cwd: opts.cwdOverride } : {}
  );
  const persisted = consent.load();

  const disabled = resolveDisabled({
    env,
    isTty,
    isDocker,
    enabledInConfig: persisted.enabled,
  });

  const baseContext = {
    ...collectBaseContext(opts.cliName, opts.cliVersion),
    is_docker: isDocker,
  };

  // Only construct the client if we're actually going to send events.
  const client = disabled.disabled
    ? null
    : createTelemetryClient({ token: POSTHOG_TOKEN, host: TELEMETRY_ENDPOINT });

  state = {
    client,
    disabled,
    baseContext,
    distinctId: persisted.anonymousId,
    salt: persisted.salt,
    consent,
    sessionId: randomSessionId(),
    cwd: process.cwd(),
  };

  // Banner goes AFTER we have a valid consent state so we can persist notifiedAt.
  maybeShowBanner({
    disabled: disabled.disabled,
    notifiedAt: persisted.notifiedAt,
    markNotified: () => consent.markNotified(),
  });
}

export function capture<K extends EventName>(
  event: K,
  properties: EventProperties<K>
): void {
  if (!state || !state.client) return;
  const project_id =
    state.baseContext.cli_name === "nextly"
      ? hashProjectId(state.cwd, state.salt)
      : null;

  state.client.capture({
    distinctId: state.distinctId,
    event,
    properties: {
      ...state.baseContext,
      session_id: state.sessionId,
      project_id,
      ...(properties as Record<string, unknown>),
    },
  });
}

export async function shutdown(): Promise<void> {
  if (!state || !state.client) return;
  await state.client.shutdown();
}

export function getStatus(): DisabledResult {
  if (!state) return { disabled: true, reason: "config" };
  return state.disabled;
}

export function setEnabled(enabled: boolean): void {
  if (!state) {
    throw new Error("telemetry.init() must be called before setEnabled()");
  }
  state.consent.setEnabled(enabled);
}

export function resetConsent(): void {
  if (!state) {
    throw new Error("telemetry.init() must be called before resetConsent()");
  }
  state.consent.reset();
}
