/**
 * Which paths the admin's startup request may name, and how many.
 *
 * Its own module, with no imports: the startup route refuses by this rule,
 * a plugin's declared startup reads are checked by it at boot, and the admin
 * keeps its request within the same bound, so a request the admin sends is
 * one the route accepts.
 *
 * @module route-handler/startup-path
 */

/** The most paths one startup request may name. */
export const MAX_STARTUP_PATHS = 16;

/**
 * Whether `path` is one the startup request may name: a path within the admin
 * API, a leading `/` and plain segments (a plugin's scoped name, `@scope/x`,
 * among them), an optional query, at most 512 characters, never a step up
 * (`..`) and never the startup route itself.
 */
export function isStartupPath(path: string): boolean {
  if (path.length > 512) return false;
  if (!/^\/[A-Za-z0-9._~\-/@]*(\?[^#\s]*)?$/.test(path)) return false;
  const segments = path.split("?")[0].split("/");
  return !segments.includes("..") && segments[1] !== "startup";
}
