import { createConsentStore } from "../consent.js";

// The machine's own usage-data setting, read and written through the same
// store `nextly telemetry enable | disable | reset` already use (the user's
// config folder), so the installer and the CLI agree on one answer per
// machine.

export interface MachineStoreOptions {
  /** For tests: the folder that holds the store instead of the user's. */
  cwd?: string;
}

export interface MachineUsage {
  /** The machine's own setting; the guard reads it as a person's "no". */
  enabled: boolean;
  /** The machine's random id, sent as the event's id by the tools. */
  anonymousId: string;
}

export function readMachineUsage(opts: MachineStoreOptions = {}): MachineUsage {
  const state = createConsentStore(opts.cwd ? { cwd: opts.cwd } : {}).load();
  return { enabled: state.enabled, anonymousId: state.anonymousId };
}

/**
 * Saves "off" on this machine, as `nextly telemetry disable` does: what the
 * installer calls when a person turns usage data off for its run. Sends
 * nothing.
 */
export function saveMachineUsageOff(opts: MachineStoreOptions = {}): void {
  createConsentStore(opts.cwd ? { cwd: opts.cwd } : {}).setEnabled(false);
}
