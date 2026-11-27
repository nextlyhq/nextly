/**
 * Whether a package's entry has what its registration names: the export, and
 * a function there when the registration says it is called. Asked by
 * `nextly plugins add` before it makes the plugin, and by a plugin's own
 * suite, so both find a misspelt or retyped export in the same words.
 *
 * @module plugins/declaration/registration-target
 */
import type { PluginPackageRegistration } from "./format";

/**
 * Why `exports` cannot be registered as `registration` says, as a sentence
 * without its full stop, or nothing when it can. The export is never called
 * here: what calling it needs, and what it does, are the plugin's.
 */
export function registrationTargetProblem(
  registration: Pick<PluginPackageRegistration, "export" | "call">,
  exports: Readonly<Record<string, unknown>>
): string | undefined {
  const exported = exports[registration.export];
  if (exported === undefined) {
    return `It names the export ${registration.export}, which its entry does not have`;
  }
  if (registration.call === true && typeof exported !== "function") {
    return `It says ${registration.export} is called, and it is not a function`;
  }
  return undefined;
}
