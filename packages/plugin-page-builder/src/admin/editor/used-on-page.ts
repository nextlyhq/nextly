/**
 * The variables the open page uses, for the Colours tab's "Used on this
 * page": read from the editor's document, so an edit not yet saved counts at
 * once, with every component inlined as the canvas draws it (a placement's
 * override or variant included), the shared styles and block looks its
 * blocks wear, and each variable a used variable names through `var()`.
 *
 * Each part is read by the walk the site's usage index records with
 * (`documentTokenUsage`, `classUsageOf`, `variablesAsked`, `variablesUsing`),
 * so the filter and the counts agree on what a use is.
 *
 * @module used-on-page
 */
import {
  documentTokenUsage,
  resolveComponentInstances,
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

export function usedOnPage(
  document: BlockDocument,
  components: ComponentLookup,
  limits: DocumentLimits,
  tokens: SiteTokenSet | undefined,
  classes: readonly NamedClass[] = []
): ReadonlySet<string> {
  const rendered = resolveComponentInstances(document, components, {
    limits,
  }).document;
  const usage = documentTokenUsage(rendered, limits);
  const ids = new Set(usage.ids);
  const properties = new Set(usage.properties);
  // The shared styles and looks the page's blocks wear, as composed.
  const worn = new Set(classUsageOf(document, limits, components).ids);
  for (const style of classes) {
    if (!worn.has(style.id)) continue;
    styleEnvelopeTokens(style.styles, ids);
    styleEnvelopeProperties(style.styles, properties);
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
