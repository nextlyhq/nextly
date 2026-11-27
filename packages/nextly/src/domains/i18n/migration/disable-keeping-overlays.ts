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

/**
 * The refusal of a change that makes a shared field inside a repeater or group of `entity`
 * translated (`fieldsTurningTranslatedInside`), naming each by path, or `undefined` where there is
 * none. Its value is stored on the structure, every language's: read as text from then on, the
 * first save in one language would take it for that language alone, and every other language
 * would read none.
 */
export function fieldTurningTranslatedRefusal(
  entity: { kind: I18nTransitionKind; slug: string },
  fields: readonly string[]
): NextlyError | undefined {
  if (fields.length === 0) return undefined;
  const named = fields.map(name => `"${name}"`).join(", ");
  return NextlyError.invalidInput({
    message:
      `This change to the ${KIND_NAMES[entity.kind]} "${entity.slug}" isn't supported yet: ` +
      `${named} inside a repeater or group would become translated, and the value each entry ` +
      `holds there is shared by every language; the first save in one language would take it for ` +
      `that language alone, and every other language would lose it. Nothing was changed. To go on ` +
      `today, add a new translated field beside it and copy the values in.`,
    logContext: {
      reason: "container-field-turning-translated",
      entity: entity.slug,
      kind: entity.kind,
      fields: [...fields],
    },
  });
}

/**
 * The refusal of a change that leaves a repeater or group of `entity` keeping its text per
 * language with nothing inside it translated any more (its last translated field made shared, or
 * the container itself marked `localized: false`), naming each such container in `containers`, or
 * `undefined` where there is none. The container's overlay column would be dropped, and its
 * structure was stored without that text, so every language's text there would be lost.
 */
export function overlayLeftBehindRefusal(
  entity: { kind: I18nTransitionKind; slug: string },
  containers: readonly string[]
): NextlyError | undefined {
  if (containers.length === 0) return undefined;
  const sorted = [...containers].sort();
  const named = sorted.map(name => `"${name}"`).join(", ");
  return NextlyError.invalidInput({
    message:
      `This change to the ${KIND_NAMES[entity.kind]} "${entity.slug}" isn't supported yet: its ` +
      `repeaters and groups ${named} keep their text per language, and with nothing inside them ` +
      `translated any more that text, in every language, would be lost. Nothing was changed. To ` +
      `go on today, keep at least one field inside ${named} translated; or, if their text can go, ` +
      `remove ${named} from "${entity.slug}" first and save that change.`,
    logContext: {
      reason: "container-overlay-left-behind",
      entity: entity.slug,
      kind: entity.kind,
      containers: sorted,
    },
  });
}
