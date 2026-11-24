/**
 * The refusal of turning translation off for an entity whose repeaters or groups keep their text
 * per language: one rule and one message for every road that turns it off, a migration file
 * (`migrate:create`) and a Builder save alike.
 *
 * Turning translation off brings each translated column home and drops the translations table. A
 * container's text is kept apart from its structure, row by row, as an overlay in each language,
 * and no statement brings that back onto the structure, so every language's text there, the
 * default language's among it, would be lost. Until a release that carries it back, the change is
 * refused before anything is written.
 *
 * @module domains/i18n/migration/disable-keeping-overlays
 */
import { NextlyError } from "../../../errors/nextly-error";

import { KIND_NAMES } from "./resolve-entity-table";
import type { I18nTransitionKind } from "./transition-state";

/**
 * The refusal for `entity`, naming each container in `containers` (their names as the entity
 * stores them), or `undefined` where there is none to name.
 */
export function disableKeepingOverlaysRefusal(
  entity: { kind: I18nTransitionKind; slug: string },
  containers: readonly string[]
): NextlyError | undefined {
  if (containers.length === 0) return undefined;
  const sorted = [...containers].sort();
  const named = sorted.map(name => `"${name}"`).join(", ");
  return NextlyError.invalidInput({
    message:
      `Turning translation off for the ${KIND_NAMES[entity.kind]} "${entity.slug}" isn't supported ` +
      `yet: its repeaters and groups ${named} keep their text per language, and that text, in ` +
      `every language, would be lost. Nothing was changed. To go on today, either keep ` +
      `translation on for "${entity.slug}" until a release that brings those translations back ` +
      `when translation is turned off; or, if their text can go, remove ${named} from ` +
      `"${entity.slug}" first, save that change, and then turn translation off.`,
    logContext: {
      reason: "disable-with-container-overlays",
      entity: entity.slug,
      kind: entity.kind,
      containers: sorted,
    },
  });
}
