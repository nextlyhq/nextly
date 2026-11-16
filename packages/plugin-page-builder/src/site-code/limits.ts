/**
 * The bounds on site code, apart from the rules that apply them, so the
 * admin's editor can show them without loading the rules' CSS parser.
 *
 * @module site-code/limits
 * @experimental
 */

/**
 * How much site code a site may have. It ships on every page view, so the
 * bounds are generous for vendor snippets and small for a page's weight.
 */
export const SITE_CODE_LIMITS = {
  /** Characters a person may paste into one slot. */
  slotChars: 50_000,
  /** Elements one slot may hold. */
  entriesPerSlot: 40,
  /** Characters in one URL. */
  urlLength: 2048,
  /** Characters in one attribute value. */
  attributeLength: 4096,
} as const;
