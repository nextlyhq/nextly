/**
 * Where a block's default value comes from when it is one of the site's own
 * settings: a Section's padding, which reads the site's section spacing
 * variables, says "Site default: Section spacing" rather than "From block
 * defaults".
 *
 * @module site-default-source
 */
import {
  tokenCustomProperty,
  type StyleOrigin,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

/**
 * The site settings a block's defaults read, by the variable they read, in
 * the words the Style tab names them by.
 */
const SITE_DEFAULTS: Readonly<Record<string, string>> = {
  "space.section-y": "Section spacing",
  "space.gutter": "Section spacing",
};

/** The variable a written value reads whole, `var(--site-space-gutter)`. */
export function variableRead(
  value: string,
  tokenPrefix: string
): string | undefined {
  const match = /^var\((--[a-z0-9-]+)\)$/.exec(value.trim());
  if (match === null) return undefined;
  const property = match[1] ?? "";
  if (!property.startsWith(tokenPrefix)) return undefined;
  // A token name is dotted where its custom property is dashed, so the name
  // is found by reading the property back from each candidate.
  return Object.keys(SITE_DEFAULTS).find(
    name => tokenCustomProperty(name, tokenPrefix) === property
  );
}

/**
 * The site setting a value comes from, as the Style tab names it ("Site
 * default: Section spacing"), or `undefined` for a value that is not a
 * block's default reading one.
 *
 * @param origin - the tier the value was written by
 * @param entry - the declaration as the compiler wrote it
 * @param tokenPrefix - the prefix the compile wrote variables under
 */
export function siteDefaultSource(
  origin: StyleOrigin,
  entry: StyleTraceEntry,
  tokenPrefix: string
): string | undefined {
  if (origin.kind !== "blockType" || origin.part !== undefined) {
    return undefined;
  }
  const name = variableRead(entry.value, tokenPrefix);
  return name === undefined
    ? undefined
    : `Site default: ${SITE_DEFAULTS[name]}`;
}
