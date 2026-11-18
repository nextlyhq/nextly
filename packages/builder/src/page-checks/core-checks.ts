/**
 * The checks the builder itself runs on every page. A plugin's checks are
 * offered beside them, never in place of them.
 *
 * @module page-checks/core-checks
 * @experimental Grows as the builder's own checks are written.
 */
import { FORM_NOWHERE_CHECK } from "./form-nowhere-check";
import { IMAGE_ALT_CHECK } from "./image-alt-check";
import type { PageCheck } from "./page-checks";

/** The builder's own checks, in the order they are run. */
export const CORE_PAGE_CHECKS: readonly PageCheck[] = [
  IMAGE_ALT_CHECK,
  FORM_NOWHERE_CHECK,
];
