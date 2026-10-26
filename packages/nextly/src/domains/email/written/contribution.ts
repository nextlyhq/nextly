/**
 * Whether an owner's contribution can be a template: HTML or blocks, never
 * both or neither, blocks that pass the written rules, and no `legacy` engine
 * on blocks (a written template is always rendered as Liquid).
 *
 * One answer for both places that ask: the plugin manifest check, which
 * refuses the boot, and the owner registry, which refuses the template.
 *
 * @module domains/email/written/contribution
 */

import { writtenDocumentSchema, type WrittenDocument } from "./document";

/** The parts of a contribution that decide its format. */
export interface ContributedFormat {
  htmlContent?: unknown;
  blocks?: unknown;
  engine?: unknown;
}

/**
 * Why a contribution can't be a template, in a clause the caller puts after
 * the template's name, or null when it can.
 */
export function contributionProblem(
  template: ContributedFormat
): string | null {
  const html = template.htmlContent !== undefined;
  const blocks = template.blocks !== undefined;
  if (html && blocks) return "gives both HTML and blocks; give one";
  if (!html && !blocks) return "gives neither HTML nor blocks";
  if (!blocks) return null;
  if (template.engine === "legacy") {
    return 'is written in blocks, which always render as Liquid; leave out engine "legacy"';
  }
  const parsed = writtenDocumentSchema.safeParse(template.blocks);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = ["blocks", ...issue.path].join(".");
    return `has blocks that don't pass the written rules (${where}: ${issue.message})`;
  }
  return null;
}

/** A contribution's blocks, once `contributionProblem` has passed them. */
export function contributedBlocks(template: {
  blocks?: unknown;
}): WrittenDocument | null {
  if (template.blocks === undefined) return null;
  return writtenDocumentSchema.parse(template.blocks);
}
