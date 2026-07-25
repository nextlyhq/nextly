/**
 * Server-side validation for a blocks field value.
 *
 * The document format has one validator, and it lives in the engine. This
 * module adapts it to the field system rather than restating any of its rules:
 * it hands the stored value to `validate()` and translates what comes back
 * into the issue shape the write path already reports.
 *
 * Two rules do belong here, because they are properties of the FIELD rather
 * than of the document: which document kinds this field accepts, and which of
 * the registered block types it permits. A document that is perfectly valid on
 * its own can still be wrong for the field it was written to.
 *
 * Block-type EXISTENCE is deliberately not checked here. That needs the boot
 * registry, which nothing populates until plugins contribute their blocks, and
 * checking against an empty registry would reject every document.
 *
 * @module collections/fields/validators/blocks-validator
 */

import type { BlockDocument, BreakpointSet } from "@nextlyhq/blocks-engine";
import { validate, walkNodes } from "@nextlyhq/blocks-engine";

import type { ValidationPublicData } from "../../../errors/public-data";
import type { DocumentKind } from "../types/blocks";

type Issue = ValidationPublicData["errors"][number];

/** The field options this validator reads, in their loosest usable form. */
export interface BlocksValidationOptions {
  /** Registered block names allowed; a trailing `*` matches a namespace. */
  allow?: string[];
  /** Document kinds accepted; defaults to page-only. */
  kinds?: DocumentKind[];
}

/**
 * Breakpoints are site-level data owned by the page-builder plugin, and the
 * engine never reads storage, so core validates against an empty set. A
 * document referencing a breakpoint id therefore warns rather than errors
 * until the plugin supplies the real set — which is the arrangement that keeps
 * the engine storage-agnostic.
 */
const NO_BREAKPOINTS: BreakpointSet = { viewport: [], container: [] };

/** What a field accepts when it says nothing: its own entry's page content. */
const DEFAULT_KINDS: readonly DocumentKind[] = ["page"];

/**
 * How many document issues one field reports. A document may hold thousands of
 * nodes, and a writer cannot act on thousands of messages; the count of what
 * was withheld is reported instead so the total is never misrepresented.
 */
const MAX_REPORTED_ISSUES = 20;

/**
 * Validate one blocks field value. Returns issues addressed to `path`, the
 * field's own location, because the admin renders a blocks field as a single
 * control — the position inside the document travels in the message.
 */
export function validateBlocksValue(
  value: unknown,
  path: string,
  label: string,
  options: BlocksValidationOptions
): Issue[] {
  // An absent document is an empty field. Required-ness is the shared rules'
  // to enforce, exactly as for every other type.
  if (value === null || value === undefined) return [];

  if (typeof value !== "object" || Array.isArray(value)) {
    return [
      {
        path,
        code: "INVALID_TYPE",
        message: `${label} must be a page document.`,
      },
    ];
  }

  const doc = value as BlockDocument;
  const issues: Issue[] = [];

  // The engine owns every structural rule: ids, depth, node and byte caps,
  // slot legality, the kind enum, binding and style shapes.
  const documentIssues = validate(doc, {
    breakpoints: NO_BREAKPOINTS,
    mode: "forgiving",
  }).filter(issue => issue.severity === "error");

  for (const issue of documentIssues) {
    issues.push({
      path,
      // The engine's codes are the documented repair vocabulary. Translating
      // them into a second dialect here would give one defect two names.
      code: issue.code,
      message: `${label}${issue.path}: ${issue.message}`,
    });
  }

  issues.push(...kindIssues(doc, path, label, options));
  issues.push(...disallowedBlockIssues(doc, path, label, options));

  if (issues.length <= MAX_REPORTED_ISSUES) return issues;
  const withheld = issues.length - MAX_REPORTED_ISSUES;
  return [
    ...issues.slice(0, MAX_REPORTED_ISSUES),
    {
      path,
      code: "TOO_MANY_ISSUES",
      message: `${label} has ${withheld} further problem${withheld === 1 ? "" : "s"} not listed here.`,
    },
  ];
}

/** Whether the document is the kind of thing this field holds. */
function kindIssues(
  doc: BlockDocument,
  path: string,
  label: string,
  options: BlocksValidationOptions
): Issue[] {
  const kinds = options.kinds ?? DEFAULT_KINDS;
  if (typeof doc.kind !== "string" || kinds.includes(doc.kind)) return [];
  return [
    {
      path,
      code: "DISALLOWED_DOCUMENT_KIND",
      message: `${label} does not accept a ${doc.kind} document. Accepted: ${kinds.join(", ")}.`,
    },
  ];
}

/** Which block types the field permits, independent of which ones exist. */
function disallowedBlockIssues(
  doc: BlockDocument,
  path: string,
  label: string,
  options: BlocksValidationOptions
): Issue[] {
  const allow = options.allow;
  if (!allow || allow.length === 0) return [];
  if (!Array.isArray(doc.nodes)) return [];

  const disallowed = new Set<string>();
  walkNodes(doc.nodes, node => {
    if (typeof node.type === "string" && !isAllowed(node.type, allow)) {
      disallowed.add(node.type);
    }
  });
  if (disallowed.size === 0) return [];

  return [
    {
      path,
      code: "DISALLOWED_BLOCK_TYPE",
      message: `${label} does not accept ${[...disallowed].sort().join(", ")}. Accepted: ${allow.join(", ")}.`,
    },
  ];
}

/** Exact name match, or a namespace match when the pattern ends in `*`. */
function isAllowed(type: string, allow: readonly string[]): boolean {
  return allow.some(pattern =>
    pattern.endsWith("*")
      ? type.startsWith(pattern.slice(0, -1))
      : type === pattern
  );
}
