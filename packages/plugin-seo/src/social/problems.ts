/**
 * What is wrong with a page's share image, for the SEO tab and the problem
 * list: a picture networks crop or shrink, and one whose address a network
 * cannot load.
 *
 * Shaped as structured data's problems are: each names what it is about, the
 * sentence the list shows, and where it is fixed.
 *
 * @module social/problems
 */
import type { PageMetadataInput, PluginContext } from "@nextlyhq/plugin-sdk";

import type { SeoLevel } from "../resolver/order";
import { resolveSeo, type ReadRules } from "../resolver/provider";
import { readSeoRules } from "../settings/rules";
import { socialCardFromSettings } from "../settings/social-card-rules";

import {
  cardOrigin,
  isAbsolute,
  socialCardRulesFromOptions,
  type ReadSocialCardRules,
} from "./card";
import { shareImageFormatProblem, shareImageSizeProblem } from "./contract";

/** The card's rules with no plugin options: the site's environment alone. */
const fromEnvironment = socialCardRulesFromOptions(undefined, undefined);

/** Something about a page's share image that keeps its card from showing well. */
export interface ShareImageProblem {
  /**
   * What it is about: the picture's size or shape (`size`), its file type
   * where some networks don't show it (`format`), or the site's address the
   * picture's own address is stated on (`siteAddress`).
   */
  detail: "size" | "format" | "siteAddress";
  /** What the problem list shows, such as `800 × 600, LinkedIn will crop it`. */
  message: string;
  /**
   * Where it is fixed: by making a share image from the picture (`make`), in
   * the code or design that sets the picture (`route`), since a picture set
   * there is not in the media library to be made from, or in the SEO
   * settings (`settings`), the site's address.
   */
  fix: "make" | "route" | "settings";
  /** The level of the order the picture comes from. */
  from: SeoLevel;
  /** The page's field the picture is read from, where one is. */
  field?: string;
}

/** Where a share image from `from` is fixed. */
function fixFor(from: SeoLevel): ShareImageProblem["fix"] {
  return from === "code" || from === "template" ? "route" : "make";
}

/** Where a page's share image problems read their rules from. */
export interface ShareImageReaders {
  /** The resolver's rules, as the head reads them. */
  readRules?: ReadRules;
  /** The social card's rules, as the head reads them. */
  readSocialCardRules?: ReadSocialCardRules;
}

/**
 * What is wrong with the share image of the page `input` names, as its head
 * would be served: nothing where it has none.
 */
export async function shareImageProblems(
  ctx: PluginContext,
  input: PageMetadataInput,
  readers: ShareImageReaders = {}
): Promise<ShareImageProblem[]> {
  // The rules the page's own head is answered with: the SEO settings when
  // the caller gives none.
  const answer = await resolveSeo(
    ctx,
    input,
    readers.readRules ?? readSeoRules
  );
  const image = answer.image;
  if (image === undefined) return [];
  const where = {
    from: image.from,
    ...(image.field === undefined ? {} : { field: image.field }),
  };
  const problems: ShareImageProblem[] = [];
  const size = shareImageSizeProblem(image.value);
  if (size !== undefined) {
    problems.push({
      detail: "size",
      message: size,
      fix: fixFor(image.from),
      ...where,
    });
  }
  // A making of a share image writes a JPEG, which every network shows.
  const format = shareImageFormatProblem(image.value.url);
  if (format !== undefined) {
    problems.push({
      detail: "format",
      message: format,
      fix: fixFor(image.from),
      ...where,
    });
  }
  // The card's rules as the head reads them: the SEO settings, then the
  // site's environment, when the caller gives none.
  const readCard =
    readers.readSocialCardRules ?? socialCardFromSettings(fromEnvironment);
  const rules = await readCard(ctx, input.locale);
  if (
    !isAbsolute(image.value.url) &&
    cardOrigin({ canonical: answer.canonical?.value }, rules) === undefined
  ) {
    problems.push({
      detail: "siteAddress",
      message:
        "The share image has no full address: networks cannot load it until the site's address is set",
      fix: "settings",
      ...where,
    });
  }
  return problems;
}
