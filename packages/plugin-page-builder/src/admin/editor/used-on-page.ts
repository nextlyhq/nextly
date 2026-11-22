/**
 * The variables the open page uses, for the Colours tab's "Used on this
 * page": read from the editor's document and the header and footer drawn
 * around it, so an edit not yet saved counts at once, with every component inlined as the canvas draws it (a placement's
 * override or variant included), the shared styles and block looks its
 * blocks wear, the site's text (which every page takes), and each variable
 * a used variable names through `var()`.
 *
 * Each part is read by the walk the site's usage index records with
 * (`documentTokenUsage`, `classUsageOf`, `variablesAsked`, `variablesUsing`),
 * so the filter and the counts agree on what a use is.
 *
 * @module used-on-page
 */
import {
  blockDefaultsOf,
  documentTokenUsage,
  selectNodes,
  resolveComponentInstances,
  siteTextUses,
  styleEnvelopeProperties,
  styleEnvelopeTokens,
  tokenIdentity,
  type BlockDocument,
  type ComponentLookup,
  type DocumentLimits,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { classUsageOf } from "../../class-usage";
import {
  usageKeysOf,
  variablesAsked,
  variablesUsing,
  type VariablesAsked,
} from "../../token-usage";

/** One document the page draws, with the components it reaches. */
export interface PageDocument {
  readonly document: BlockDocument;
  readonly components: ComponentLookup;
}

export function usedOnPage(
  parts: readonly PageDocument[],
  limits: DocumentLimits,
  tokens: SiteTokenSet | undefined,
  classes: readonly NamedClass[] = []
): ReadonlySet<string> {
  const ids = new Set<string>();
  const properties = new Set<string>();
  const worn = new Set<string>();
  const types = new Set<string>();
  for (const part of parts) {
    readPart(part, limits, { ids, properties, worn, types });
  }
  // The shared styles and looks the page's blocks wear, and the site's own
  // look of each block type it draws, which no block names.
  const ownLooks = blockDefaultsOf(classes);
  const styles = [
    ...classes.filter(style => worn.has(style.id)).map(style => style.styles),
    ...[...types].flatMap(type =>
      Object.hasOwn(ownLooks, type) ? [ownLooks[type]] : []
    ),
  ];
  for (const style of styles) {
    styleEnvelopeTokens(style, ids);
    styleEnvelopeProperties(style, properties);
  }
  // The site's text, which every page's body, headings, links, buttons and
  // captions take: a row's reference by identity, or its `var()` by property.
  for (const key of siteTextUses(tokens?.siteText).keys()) {
    (key.startsWith("--") ? properties : ids).add(key);
  }
  const asked = variablesAsked(
    (tokens?.tokens ?? []).map(tokenIdentity),
    tokens?.prefix
  );
  const used = asked.identitiesIn(
    usageKeysOf({ ids: [...ids], properties: [...properties] })
  );
  return tokens === undefined ? used : withNamedVariables(used, tokens, asked);
}

/**
 * What one document references, as the canvas composes it: every component
 * inlined, a placement's override or variant applied, and one placed under a
 * condition expanded too, since a visitor may see it.
 */
function readPart(
  { document, components }: PageDocument,
  limits: DocumentLimits,
  into: {
    ids: Set<string>;
    properties: Set<string>;
    worn: Set<string>;
    types: Set<string>;
  }
): void {
  const rendered = resolveComponentInstances(document, components, {
    limits,
    conditioned: "carry",
  }).document;
  const usage = documentTokenUsage(rendered, limits);
  for (const id of usage.ids) into.ids.add(id);
  for (const property of usage.properties) into.properties.add(property);
  for (const id of classUsageOf(rendered, limits).ids) into.worn.add(id);
  for (const entry of selectNodes(rendered, limits).nodes) {
    into.types.add(entry.node.type);
  }
}

/**
 * The variables used, with each variable a used one names through `var()`,
 * and those it names in turn: a shadow on the page uses its colour.
 */
function withNamedVariables(
  used: Set<string>,
  tokens: SiteTokenSet,
  asked: VariablesAsked
): Set<string> {
  const naming = [...variablesUsing(tokens, asked)];
  for (let grew = true; grew; ) {
    grew = false;
    for (const [identity, namers] of naming) {
      if (used.has(identity) || !namers.some(namer => used.has(namer.id))) {
        continue;
      }
      used.add(identity);
      grew = true;
    }
  }
  return used;
}
