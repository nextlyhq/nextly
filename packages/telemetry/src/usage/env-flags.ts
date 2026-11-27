// How the usage-data rules read the environment. Two readings, kept apart on
// purpose:
//
// - an "off" switch a person sets (`DO_NOT_TRACK`, `NEXTLY_TELEMETRY_DISABLED`)
//   counts only as `1` or `true`, the values the docs name, so `0`, `false`
//   or an empty value leaves usage data on;
// - a marker a platform sets (`CI`, `VERCEL`, an agent's variable) counts
//   whenever it holds anything but empty, `0` or `false`, because platforms
//   set them to `1`, `true` or an id.

export type Env = Readonly<Record<string, string | undefined>>;

/** True when a person's off switch is set to `1` or `true`. */
export function isSwitchedOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** True when a platform marker is present and not set to a "no" value. */
export function isMarkerSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && v !== "0" && v !== "false";
}

/**
 * The variables a person sets to say no, in the order a "why is it off"
 * answer names them. Both the tools' guard and the site guard honour them.
 */
const PERSON_OFF_VARIABLES = [
  "DO_NOT_TRACK",
  "NEXTLY_TELEMETRY_DISABLED",
] as const;
export type PersonOffVariable = (typeof PERSON_OFF_VARIABLES)[number];

/** The first person's off variable set in `env`, or null. */
export function personOffVariable(env: Env): PersonOffVariable | null {
  for (const name of PERSON_OFF_VARIABLES) {
    if (isSwitchedOn(env[name])) return name;
  }
  return null;
}
