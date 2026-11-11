/**
 * The SEO panel's values: what it edits in the `seo` group, the share image
 * a person chose, and the page's answer worked out from them.
 *
 * @module admin/values
 */
import type { PageMetadataImage } from "@nextlyhq/plugin-sdk";

import { resolveOrder, type SeoAnswer } from "../resolver/order";
import type { SeoTabContext } from "../tab/contract";
import { typedPageLevel } from "../tab/typed";

/** The `seo` group's values the panel edits. */
export const SEO_PANEL_FIELDS = [
  "metaTitle",
  "metaDescription",
  "socialTitle",
  "socialDescription",
  "ogImage",
  "canonical",
  "canonicalElsewhere",
  "noindex",
  "structuredDataType",
] as const;

/** One value the panel edits. */
export type SeoPanelField = (typeof SEO_PANEL_FIELDS)[number];

/** The values the panel edits, as the document's form holds them. */
export type SeoPanelValues = Partial<Record<SeoPanelField, unknown>>;

/** A share image a person chose, as the panel shows it. */
export interface ChosenImage {
  url: string;
  filename?: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** The page's answer, and what it would be with nothing typed. */
export interface PanelAnswers {
  answer: SeoAnswer;
  automatic: SeoAnswer;
}

/** A chosen image as the order reads a share image. */
function asMetadataImage(
  image: ChosenImage | undefined
): PageMetadataImage | undefined {
  if (image === undefined) return undefined;
  return {
    url: image.url,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
    ...(image.alt === undefined ? {} : { alt: image.alt }),
  };
}

/**
 * The page's answer from the server's levels with what is typed on top, by
 * the order the page's head is answered by, and the automatic answer the
 * fields fall back to. None until the levels have been read.
 */
export function panelAnswers(
  context: SeoTabContext | undefined,
  values: SeoPanelValues,
  chosenImage: ChosenImage | undefined
): PanelAnswers | undefined {
  if (context === undefined) return undefined;
  return {
    answer: resolveOrder({
      ...context.levels,
      page: typedPageLevel(values, asMetadataImage(chosenImage)),
    }),
    automatic: resolveOrder({ ...context.levels, page: {} }),
  };
}

/** A value as typed text, or `""` for nothing typed. */
export function typedText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Whether text with something in it is typed. */
export function isTyped(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}
