/**
 * Guard against a config still declaring field groups under the pre-rename key.
 *
 * The key was renamed rather than aliased, so nothing reads the old spelling.
 * TypeScript rejects it for `.ts` configs, but that covers only one of the
 * supported shapes: the loader also accepts `.js`/`.mjs`, plugins may be
 * compiled against an older API, and `getNextly()` / `registerServices()` take
 * an object the compiler never saw. On every one of those paths the old key
 * would simply read as absent and each field group would go unregistered
 * without a word — the one outcome this rename must not produce.
 *
 * Applied wherever a config crosses a boundary, INCLUDING after plugin setup
 * transformers run: a transformer returns a new config object, so checking only
 * the input would leave that path unguarded.
 *
 * @module shared/legacy-field-group-key
 */

import { NextlyError } from "../errors";

/**
 * Throws when `config` declares the legacy `components` key.
 *
 * @param config - Any config-shaped object crossing a boundary.
 * @param origin - Which boundary rejected it, recorded for operators.
 * @throws NextlyError(VALIDATION) with code `CONFIG_KEY_RENAMED`.
 */
export function assertNoLegacyFieldGroupKey(
  config: unknown,
  origin: string
): void {
  if (typeof config !== "object" || config === null) return;
  if ((config as { components?: unknown }).components === undefined) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "components",
        code: "CONFIG_KEY_RENAMED",
        message:
          "'components' is now 'fieldGroups'. Rename the key: the old one is " +
          "no longer read.",
      },
    ],
    logContext: { reason: "legacy-field-group-key", origin },
  });
}
