/**
 * Which values inside a plugin's settings are secrets.
 *
 * A plugin names its secrets by PATH rather than by top-level key, because a
 * provider's client secret usually lives inside a nested object beside things
 * that are not secret at all — `providers.google.clientSecret` next to
 * `providers.google.clientId`. Encrypting the whole object would make the
 * readable half unreadable; encrypting nothing would put the secret in the
 * database in plain text.
 *
 * A `*` segment matches any single key, so one declaration covers every
 * provider a plugin supports without naming them.
 *
 * @module domains/plugins/secret-paths
 * @since 1.0.0
 */

/** What a secret looks like once it has been redacted for the admin. */
export interface RedactedSecret {
  set: boolean;
}

/** Whether a concrete path matches a declared pattern, honouring `*`. */
export function matchesSecretPath(
  path: readonly string[],
  pattern: string
): boolean {
  const segments = pattern.split(".");
  if (segments.length !== path.length) return false;
  return segments.every((segment, i) => segment === "*" || segment === path[i]);
}

/** Whether any declared pattern covers this path. */
export function isSecretPath(
  path: readonly string[],
  patterns: readonly string[]
): boolean {
  return patterns.some(pattern => matchesSecretPath(path, pattern));
}

/**
 * The top-level keys that can contain a secret.
 *
 * Storage is one row per top-level key, so this decides which rows are marked
 * as holding a secret at all.
 */
export function secretTopLevelKeys(patterns: readonly string[]): Set<string> {
  return new Set(patterns.map(pattern => pattern.split(".")[0]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Walk a value, replacing every secret with whatever `replace` returns.
 *
 * One traversal serves encryption, decryption and redaction, so the three can
 * never disagree about which values are secret — a path encrypted on write and
 * missed on read is a value that comes back as ciphertext.
 */
export function mapSecrets(
  value: unknown,
  patterns: readonly string[],
  replace: (secret: unknown, path: string[]) => unknown,
  path: string[] = []
): unknown {
  if (path.length > 0 && isSecretPath(path, patterns)) {
    return replace(value, path);
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = mapSecrets(child, patterns, replace, [...path, key]);
  }
  return out;
}

/**
 * Replace every secret with `{ set: true | false }`.
 *
 * What the admin is shown. A secret never leaves the server, so the only thing
 * the UI can truthfully say about one is whether it has a value — which is
 * exactly what an operator needs to know to decide whether to replace it.
 */
export function redactSecrets(
  value: unknown,
  patterns: readonly string[]
): unknown {
  return mapSecrets(value, patterns, secret => ({
    set: secret !== undefined && secret !== null && secret !== "",
  }));
}
