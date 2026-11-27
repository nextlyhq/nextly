/**
 * The site-wide switch that turns AI off.
 *
 * Read on every question rather than once at boot, so an owner who sets it
 * during an incident stops every run from the next request a process serves,
 * without a restart where the host updates the environment in place. It
 * removes nothing: the provider and its settings stay as they were, and core
 * simply stops asking it.
 *
 * @module domains/ai/ai-switch
 */
import { AI_OFF_SWITCH } from "./ai-contract";

/**
 * Whether the environment turns AI off. Any value but empty, `0` or `false`
 * turns it off, so a switch set as `yes` or `TRUE` in a hurry is not quietly
 * ignored: an incident switch that fails open would keep spending.
 */
export function aiTurnedOff(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const value = env[AI_OFF_SWITCH]?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}
