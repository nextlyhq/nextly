/**
 * The branding `nextly.config` sets, as the admin page carries it.
 *
 * The app's admin route writes the configured branding into the page's first
 * HTML, as JSON in `<script type="application/json" id="nextly-admin-branding">`,
 * with only the keys the configuration sets. Read from there, the configured
 * logo is drawn from the first paint, before any request answers, and wins over
 * branding set in General settings. When the configuration sets a favicon, the
 * first HTML already links it, so the admin must leave the page's icon alone.
 *
 * An absent element, an empty object, or anything that is not that object all
 * read as "nothing configured": a page this admin version did not prebuild
 * still works, and no malformed value reaches a logo's `src`.
 *
 * @module lib/branding/configured-branding
 */
import { ADMIN_BRANDING_ELEMENT_ID } from "nextly/config";
import { z } from "zod";

import type { AdminBranding } from "@admin/types/branding";

/** The keys a configuration may set, each a non-empty string when set. */
export type ConfiguredBranding = Pick<
  AdminBranding,
  "logoUrl" | "logoUrlLight" | "logoUrlDark" | "logoText" | "favicon"
>;

const CONFIGURED_KEYS = [
  "logoUrl",
  "logoUrlLight",
  "logoUrlDark",
  "logoText",
  "favicon",
] as const satisfies readonly (keyof ConfiguredBranding)[];

const setString = z
  .string()
  .transform(value => value.trim())
  .pipe(z.string().min(1))
  .optional()
  .catch(undefined);

const configuredBrandingSchema = z.object({
  logoUrl: setString,
  logoUrlLight: setString,
  logoUrlDark: setString,
  logoText: setString,
  favicon: setString,
});

/**
 * The configured branding the page carries, with unset keys left out; an empty
 * object where it carries none. Outside a browser there is no page to read.
 */
export function readConfiguredBranding(): ConfiguredBranding {
  if (typeof document === "undefined") return {};
  // The id the layout writes the element under, shared so the two cannot drift.
  const text = document.getElementById(ADMIN_BRANDING_ELEMENT_ID)?.textContent;
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const parsed = configuredBrandingSchema.safeParse(raw);
  if (!parsed.success) return {};
  const configured: ConfiguredBranding = {};
  for (const key of CONFIGURED_KEYS) {
    const value = parsed.data[key];
    if (value !== undefined) configured[key] = value;
  }
  return configured;
}
