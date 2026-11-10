/**
 * From what an author asked for to the files the server will download.
 *
 * The request names a family, weights, styles and scripts — never an address.
 * Each is checked against a narrow grammar here and then against what the
 * family's metadata says it offers, and every address is built from the one
 * template in {@link site-fonts/contract}, pinned to the family's release.
 *
 * The plan is whole before anything is fetched, so a request over the caps is
 * refused without a single download, and a face the site already has is
 * skipped rather than stored twice.
 *
 * @module site-fonts/plan
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  FONT_ID,
  MAX_FONT_ID_LENGTH,
  SUBSET_NAME,
  type FontMetadata,
} from "./catalogue";
import {
  catalogueFileUrl,
  type AddSiteFontRequest,
  type CatalogueFile,
  type FontStyleName,
} from "./contract";

/** One file the add will download, and the face it becomes. */
export interface PlannedFile {
  /** Built from the template, never taken from anywhere else. */
  readonly url: string;
  /** What the file is called in the media library. */
  readonly fileName: string;
  /** The media library's description of the file. */
  readonly altText: string;
  /** The face it is stored as, once it has an address on this site. */
  readonly face: Omit<FontFaceDef, "src">;
}

/** What an add may plan: where files live, and how many one add may take. */
export interface PlanLimits {
  readonly filesBase: string;
  readonly maxFiles: number;
}

/** What an author is told about an id that names nothing in the catalogue. */
const NOT_IN_CATALOGUE = "That isn’t a font in the catalogue.";

const WEIGHT = z
  .number()
  .int()
  .min(100)
  .max(900)
  .refine(weight => weight % 100 === 0);

const AddFontBody = z.strictObject({
  id: z.string(),
  weights: z.union([z.literal("variable"), z.array(WEIGHT).min(1).max(9)]),
  styles: z
    .array(z.enum(["normal", "italic"]))
    .min(1)
    .max(2),
  // Every script a family offers may be asked for; the file cap, applied to
  // what would be downloaded, is what bounds an add.
  subsets: z.array(z.string().max(32).regex(SUBSET_NAME)).min(1).max(32),
});

/** A refusal naming the field and what is wrong with it. */
function invalid(path: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code: "INVALID_VALUE", message }],
  });
}

/**
 * The request, parsed at the boundary. Unknown fields are refused, so a body
 * carrying an address of its own is not quietly read past.
 */
export function readAddFontBody(raw: unknown): AddSiteFontRequest {
  const parsed = AddFontBody.safeParse(raw);
  if (!parsed.success) {
    throw invalid(
      "body",
      "That isn’t a font, its weights, styles and languages."
    );
  }
  const { id } = parsed.data;
  if (id.length > MAX_FONT_ID_LENGTH || !FONT_ID.test(id)) {
    throw invalid("id", NOT_IN_CATALOGUE);
  }
  return parsed.data;
}

/**
 * Whether a stored face is the one a planned face would add: the one test of
 * a face already on the site, for the plan and for the write that appends.
 */
export function sameFace(
  stored: FontFaceDef,
  planned: Omit<FontFaceDef, "src">
): boolean {
  return (
    stored.family.toLowerCase() === planned.family.toLowerCase() &&
    (stored.weight ?? "") === (planned.weight ?? "") &&
    (stored.style ?? "normal") === (planned.style ?? "normal") &&
    (stored.unicodeRange ?? "") === (planned.unicodeRange ?? "")
  );
}

/** Each of the request's values is one the family offers; refused if not. */
function checkOffered(request: AddSiteFontRequest, meta: FontMetadata): void {
  const name = meta.family;
  if (request.weights === "variable") {
    if (!meta.variable) {
      throw invalid(
        "weights",
        `${name} has no single file for every weight; choose its weights.`
      );
    }
  } else {
    if (meta.variable) {
      throw invalid(
        "weights",
        `${name} comes as one file covering every weight.`
      );
    }
    const missing = request.weights.find(
      weight => !meta.weights.includes(weight)
    );
    if (missing !== undefined) {
      throw invalid("weights", `${name} has no ${String(missing)} weight.`);
    }
  }
  const style = request.styles.find(each => !meta.styles.includes(each));
  if (style !== undefined) {
    throw invalid("styles", `${name} has no ${style} style.`);
  }
  // A script needs its range as well as its name: the range is what keeps a
  // reader's browser from downloading a file it has no characters for.
  const subset = request.subsets.find(
    each =>
      !meta.subsets.includes(each) || meta.unicodeRange[each] === undefined
  );
  if (subset !== undefined) {
    throw invalid("subsets", `${name} isn’t available for ${subset}.`);
  }
}

/** The weight a face declares: one value, or the range a variable file covers. */
function declaredWeight(
  meta: FontMetadata,
  weight: number | "variable"
): string {
  if (weight !== "variable") return String(weight);
  const low = Math.min(...meta.weights);
  const high = Math.max(...meta.weights);
  return low === high ? String(low) : `${String(low)} ${String(high)}`;
}

/** Every combination asked for, each value once, in a stable order. */
function combinations(
  request: AddSiteFontRequest
): Array<Pick<CatalogueFile, "subset" | "weight" | "style">> {
  const weights =
    request.weights === "variable"
      ? (["variable"] as const)
      : [...new Set(request.weights)].sort((a, b) => a - b);
  const styles: FontStyleName[] = [...new Set(request.styles)];
  const subsets = [...new Set(request.subsets)];
  return subsets.flatMap(subset =>
    weights.flatMap(weight => styles.map(style => ({ subset, weight, style })))
  );
}

/**
 * The files to download for a request, and how many asked-for faces the site
 * already has.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming what the family does not
 *   offer, or that the request is over the cap
 */
export function planFontAdd(
  request: AddSiteFontRequest,
  meta: FontMetadata,
  limits: PlanLimits,
  stored: readonly FontFaceDef[]
): { files: PlannedFile[]; skipped: number } {
  if (meta.type !== "google" || meta.id !== request.id) {
    throw invalid("id", NOT_IN_CATALOGUE);
  }
  checkOffered(request, meta);
  // The request schema bounds this (9 weights, 2 styles, 32 scripts); the cap
  // applies to the files left once faces the site has are skipped.
  const wanted = combinations(request);
  const files: PlannedFile[] = [];
  let skipped = 0;
  for (const want of wanted) {
    const weight = declaredWeight(meta, want.weight);
    const face: Omit<FontFaceDef, "src"> = {
      family: meta.family,
      weight,
      style: want.style,
      unicodeRange: meta.unicodeRange[want.subset],
      display: "swap",
      source: {
        kind: "google",
        id: meta.id,
        licence: meta.licence,
        category: meta.category,
        subset: want.subset,
      },
    };
    if (stored.some(each => sameFace(each, face))) {
      skipped += 1;
      continue;
    }
    const cut = want.weight === "variable" ? "variable" : weight;
    files.push({
      url: catalogueFileUrl(limits.filesBase, {
        id: meta.id,
        version: meta.version,
        ...want,
      }),
      fileName: `${meta.id}-${want.subset}-${cut}-${want.style}.woff2`,
      altText: `${meta.family} ${weight} ${want.style}, ${want.subset}. Google Fonts, ${meta.licence}.`,
      face,
    });
  }
  if (files.length > limits.maxFiles) {
    throw invalid(
      "weights",
      `That’s more styles than one add allows (${String(limits.maxFiles)}). Choose fewer weights or languages.`
    );
  }
  return { files, skipped };
}
