/**
 * The checks the builder itself runs on every page. A plugin's checks are
 * offered beside them, never in place of them.
 *
 * @module page-checks/core-checks
 * @experimental Grows as the builder's own checks are written.
 */
import { CONTRAST_CHECK } from "./contrast-check";
import { EMPTY_BLOCKS_CHECK } from "./empty-blocks-check";
import {
  BINDINGS_TO_FIX_CHECK,
  DOUBLED_REGIONS_CHECK,
  PAGE_DATA_CHECK,
  UNPUBLISHED_PARTS_CHECK,
} from "./fact-checks";
import { FORM_NOWHERE_CHECK } from "./form-nowhere-check";
import { HEADING_CHECK } from "./heading-check";
import { IMAGE_ALT_CHECK } from "./image-alt-check";
import { LABELS_CHECK } from "./labels-check";
import { LINK_TEXT_CHECK } from "./link-text-check";
import type { PageCheck } from "./page-checks";

/** The builder's own checks, in the order they are run. */
export const CORE_PAGE_CHECKS: readonly PageCheck[] = [
  IMAGE_ALT_CHECK,
  HEADING_CHECK,
  LINK_TEXT_CHECK,
  LABELS_CHECK,
  CONTRAST_CHECK,
  // Content and data: the page as stored and as the editor reads and counts it.
  BINDINGS_TO_FIX_CHECK,
  PAGE_DATA_CHECK,
  DOUBLED_REGIONS_CHECK,
  EMPTY_BLOCKS_CHECK,
  FORM_NOWHERE_CHECK,
  // Publishing: the parts it uses that are not live.
  UNPUBLISHED_PARTS_CHECK,
];
