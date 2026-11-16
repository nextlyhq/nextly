/**
 * The rule each content type's structured data choices are saved under in
 * the SEO settings: the same one the plugin's options are checked by.
 * Server-side, as that check is.
 *
 * @module settings/structured-data-choices
 */
import { checkedTypeRules } from "../structured-data/rules";

/** Why stored structured data choices are not ones offered; null when they are. */
export function structuredDataSettingsProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    checkedTypeRules(value);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The checker words its refusals for the plugin's options; here they are
    // the settings', so the options' prefix is left off.
    return message
      .replace(/^seoPlugin: /, "")
      .replace(/^structuredData\.types\./, "");
  }
}
