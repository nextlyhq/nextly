/**
 * The page's structured data as the SEO tab shows it: the type the page is
 * described as and how that was decided, the type it falls back to while it
 * chooses none, the types it may choose, and what keeps the type's markup
 * out. Read by structured data's own `pageStructuredData`, never a copy.
 *
 * @module tab/structured
 */
import type { PageMetadataInput, PluginContext } from "@nextlyhq/plugin-sdk";

import {
  DETAIL_LABELS,
  STRUCTURED_DATA_TYPES,
  type StructuredDataTypeKey,
} from "../structured-data/catalog";
import {
  pageStructuredData,
  type StructuredDataReaders,
} from "../structured-data/provider";

import {
  STRUCTURED_DATA_FIELD,
  type TabStructuredData,
  type TabStructuredType,
} from "./contract";
import { SEO_GROUP } from "./typed";

/** A type as the tab offers it. */
function offeredType(key: StructuredDataTypeKey): TabStructuredType {
  return { key, label: STRUCTURED_DATA_TYPES[key].label };
}

/** The input with the page's own choice of type taken out. */
function withoutChoice(input: PageMetadataInput): PageMetadataInput {
  const { source } = input;
  const document = source.kind === "entry" ? source.entry : source.document;
  const seo = document[SEO_GROUP];
  if (typeof seo !== "object" || seo === null) return input;
  const rest = Object.fromEntries(
    Object.entries(seo).filter(([name]) => name !== STRUCTURED_DATA_FIELD)
  );
  const without = { ...document, [SEO_GROUP]: rest };
  return {
    ...input,
    source:
      source.kind === "entry"
        ? { ...source, entry: without }
        : { ...source, document: without },
  };
}

/** The page's structured data for the document as typed. */
export async function tabStructuredData(
  ctx: PluginContext,
  input: PageMetadataInput,
  readers: StructuredDataReaders,
  /** What a field of the page is called on screen. */
  labelOf: (field: string) => string
): Promise<TabStructuredData> {
  const [page, automatic] = await Promise.all([
    pageStructuredData(ctx, input, readers),
    pageStructuredData(ctx, withoutChoice(input), readers),
  ]);
  return {
    type: offeredType(page.type),
    chosen: page.chosen,
    automatic: offeredType(automatic.type),
    offered: page.offered.map(offeredType),
    problems: page.problems.map(problem => ({
      message: problem.message,
      fix: problem.fix,
      ...(problem.field === undefined
        ? {}
        : {
            field: {
              name: problem.field,
              label: labelOf(problem.field),
            },
          }),
    })),
    details: STRUCTURED_DATA_TYPES[page.type].needs.map(
      detail => DETAIL_LABELS[detail]
    ),
  };
}
