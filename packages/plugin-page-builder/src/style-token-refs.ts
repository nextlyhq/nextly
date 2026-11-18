/**
 * Which variables (design tokens) a style envelope names: the engine's one
 * walk (`document-token-usage`), which the export, the usage index and the
 * editor all read, named here for this package's callers.
 *
 * @module style-token-refs
 */
export {
  collectStyleProperties,
  collectStyleTokens,
  forEachStyleValues,
  styleEnvelopeProperties,
  styleEnvelopeTokens,
} from "@nextlyhq/blocks-engine";
