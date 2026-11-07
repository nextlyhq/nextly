/**
 * The site settings a page may bind, each with its field type: the one table
 * the renderer, the save's binding check and the report of bindings to fix
 * all judge a site binding by, so a binding to a setting a page is never
 * handed is refused at save as the renderer falls it back.
 *
 * Only these: the settings also hold values no visitor may see, such as the
 * administrator's address, so a page is handed this allowlist and nothing
 * else.
 *
 * @module site-setting-fields
 */
import type { BindingFieldShape } from "./binding-rules";

/**
 * The type of each site setting a page may bind, keyed by the setting.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_SETTING_FIELD_TYPES = {
  applicationName: "text",
  siteUrl: "url",
  logoUrl: "url",
  timezone: "text",
} as const;

/** A site setting a page may bind. */
export type SiteSettingName = keyof typeof SITE_SETTING_FIELD_TYPES;

/**
 * The site settings' field shapes, derived from the table above.
 *
 * @experimental Settles with the editor's binding controls.
 */
export const SITE_SETTING_FIELD_SHAPES: readonly BindingFieldShape[] =
  Object.entries(SITE_SETTING_FIELD_TYPES).map(([name, type]) => ({
    name,
    type,
  }));
