import { randomBytes } from "crypto";
import { writeFileSync } from "fs";

import Conf from "conf";

import { CONF_PROJECT_NAME } from "./constants.js";

export interface ConsentState {
  anonymousId: string; // 64 hex chars
  salt: string; // 32 hex chars
  enabled: boolean;
  notifiedAt: number | null;
}

interface Schema {
  telemetry: ConsentState;
}

export interface ConsentStore {
  load(): ConsentState;
  setEnabled(enabled: boolean): void;
  markNotified(): void;
  reset(): void;
  writeRaw(raw: string): void; // test-only; simulates corruption
}

interface CreateConsentStoreOptions {
  /**
   * Override the config file directory. Production code omits this and lets
   * `conf` pick the OS-appropriate user config dir via env-paths. Tests pass
   * a tmp dir so they stay hermetic.
   */
  cwd?: string;
}

function freshState(): ConsentState {
  return {
    anonymousId: randomBytes(32).toString("hex"),
    salt: randomBytes(16).toString("hex"),
    enabled: true,
    notifiedAt: null,
  };
}

function isValidState(value: unknown): value is ConsentState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ConsentState>;
  return (
    typeof v.anonymousId === "string" &&
    typeof v.salt === "string" &&
    typeof v.enabled === "boolean" &&
    (v.notifiedAt === null || typeof v.notifiedAt === "number")
  );
}

export function createConsentStore(
  opts: CreateConsentStoreOptions = {}
): ConsentStore {
  const conf = new Conf<Schema>({
    projectName: CONF_PROJECT_NAME,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    // Reset on malformed JSON instead of crashing. Matches Next.js / Astro behavior.
    clearInvalidConfig: true,
    defaults: { telemetry: freshState() },
  });

  function load(): ConsentState {
    const existing = conf.get("telemetry");
    if (!isValidState(existing)) {
      const fresh = freshState();
      conf.set("telemetry", fresh);
      return fresh;
    }
    return existing;
  }

  function setEnabled(enabled: boolean): void {
    const state = load();
    conf.set("telemetry", { ...state, enabled });
  }

  function markNotified(): void {
    const state = load();
    conf.set("telemetry", { ...state, notifiedAt: Date.now() });
  }

  function reset(): void {
    conf.set("telemetry", freshState());
  }

  function writeRaw(raw: string): void {
    // Test-only: simulates a corrupt config file so we can verify recovery.
    // `conf` exposes the underlying file path on the instance.
    const path = conf.path;
    writeFileSync(path, raw, "utf8");
  }

  return { load, setEnabled, markNotified, reset, writeRaw };
}
