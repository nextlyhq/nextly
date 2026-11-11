/**
 * A widget's textarea settings held to their `maxLength`, counted as the
 * server counts them.
 *
 * `textLength`, from `nextly/config`, is the ONE counter: the layout write
 * refuses a note over its bound with it, so the drawer asks it the same question
 * before Save, and counts the characters left with it. The bound is not handed
 * to the textarea, whose native attribute counts UTF-16 units: it would stop a
 * reader typing emoji well before a bound the server would accept.
 *
 * @module components/features/widgets/edit/setting-length
 */

import { textLength, type AnyWidgetSetting } from "nextly/config";

/** A textarea setting whose value is over its bound: the setting, and its bound. */
export interface OverlongSetting {
  name: string;
  maxLength: number;
}

/** The first textarea setting whose value in `values` is over its `maxLength`, or `undefined`. */
export function overlongSetting(
  settings: readonly AnyWidgetSetting[],
  values: Record<string, unknown>
): OverlongSetting | undefined {
  for (const setting of settings) {
    if (setting.type !== "textarea" || setting.maxLength === undefined) {
      continue;
    }
    const value = values[setting.name];
    if (typeof value === "string" && textLength(value) > setting.maxLength) {
      return { name: setting.name, maxLength: setting.maxLength };
    }
  }
  return undefined;
}

/** What the drawer says under a note over its bound. */
export function overlongMessage(maxLength: number): string {
  return `At most ${maxLength} characters.`;
}
