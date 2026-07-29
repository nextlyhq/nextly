/**
 * Guard against Direct API callers still reaching for the pre-rename namespace.
 *
 * `nextly.components` became `nextly.fieldGroups`, and the old name was renamed
 * rather than aliased. TypeScript catches the old spelling in typed callers, but
 * the Direct API is also reached from `.js`/`.mjs` app code, from plugins
 * compiled against an older version, and through dynamic property access that
 * the compiler never sees. On those paths the property would simply read as
 * `undefined`, so the first call would surface as
 * `TypeError: Cannot read properties of undefined (reading 'find')` — a message
 * that names neither the namespace nor the rename.
 *
 * Installing a throwing accessor keeps the failure loud, which is the same
 * choice the config surface made, while replacing that TypeError with the one
 * instruction a caller needs.
 *
 * @module direct-api/legacy-field-groups-namespace
 */

import { NextlyError } from "../errors/nextly-error";

/**
 * Install a `components` accessor that rejects the pre-rename namespace.
 *
 * Defined as non-enumerable so it stays invisible to spreads, `Object.keys`,
 * and `JSON.stringify` — reading it through any of those would otherwise throw
 * on objects that merely get copied.
 *
 * @param target - The Direct API surface to guard (a `Nextly` prototype or the
 *   `nextly` facade object).
 */
export function installLegacyFieldGroupsNamespaceGuard(target: object): void {
  Object.defineProperty(target, "components", {
    get(): never {
      throw NextlyError.invalidInput({
        message:
          "'nextly.components' is now 'nextly.fieldGroups'. Rename the call: " +
          "the old namespace is no longer served.",
        logContext: { reason: "legacy-field-groups-namespace" },
      });
    },
    enumerable: false,
    configurable: true,
  });
}
