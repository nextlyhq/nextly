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
import {
  DOCUMENT_VERDICT_CODES,
  validate,
  walkNodes,
} from "@nextlyhq/blocks-engine";

import type { DocumentKind } from "./blocks-options";

/**
 * The issue shape core's validation envelope carries. Declared structurally
 * rather than imported: it is the published `{ path, code, message }` contract,
 * and depending on core's internal error module would tie this plugin to a
 * type it does not own.
 */
interface Issue {
  path: string;
  code: string;
  message: string;
}

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
  // Two of the engine's verdicts are about the whole document rather than its
  // STRUCTURE: it is too large, or it holds a value JSON cannot write. Neither
  // makes the tree unsafe to walk, so neither should block the richer walks
  // below — blocking on them costs the author the more useful answer.
  // Asked of the engine rather than restated here. This set names the engine's
  // own whole-document verdicts, and a copy of it in this package is a second
  // statement that goes stale silently: the engine gained a third and a fourth
  // verdict, a two-name copy classified them as structural, and the precise
  // per-key report below was dropped in favour of the summary it exists to
  // replace.
  const NON_STRUCTURAL = DOCUMENT_VERDICT_CODES;

  // The engine owns every structural rule: ids, depth, node and byte caps,
  // slot legality, the kind enum, binding and style shapes.
  const documentIssues = validate(doc, {
    breakpoints: NO_BREAKPOINTS,
    mode: "forgiving",
  }).filter(issue => issue.severity === "error");
  const structuralIssues = documentIssues.filter(
    issue => !NON_STRUCTURAL.has(issue.code)
  );

  // The engine's whole-document verdict is a SUMMARY of what the walk below
  // reports precisely, so it is held back until that walk has run: if the walk
  // names the offending keys, the summary says the same thing less usefully and
  // is dropped; if the walk reaches nothing, the summary is the only answer
  // there is and must survive.
  //
  // One question, one answer — and the more precise answer is the one an author
  // can act on.
  // Safe to walk is not the same as affordable to walk. `unserializableIssues`
  // serializes the whole document, which is precisely the allocation the
  // engine's bounded counter refused to make: it stops counting at the cap, so
  // a document reported as too large may be arbitrarily bigger than the cap and
  // materializing a full JSON copy of it here would undo that bound.
  //
  // Nothing is lost by skipping it. "Too large" is already the complete and
  // actionable answer, and naming a key inside a document that has to shrink
  // anyway does not change the repair.
  //
  // `document-unwritable` is the opposite case and still runs: the counter
  // stopped on a value it could not write while still under the cap, and the
  // engine can only say THAT the document is unwritable, never which key.
  const tooLarge = documentIssues.some(
    issue => issue.code === "document-too-large"
  );

  const precise: Issue[] = [];
  if (structuralIssues.length === 0 && !tooLarge) {
    precise.push(...disallowedBlockIssues(doc, path, label, options));
    precise.push(...unserializableIssues(doc, path, label));
  }
  const namesUnwritableKeys = precise.some(
    issue => issue.code === "UNSERIALIZABLE_VALUE"
  );

  for (const issue of documentIssues) {
    if (issue.code === "document-unwritable" && namesUnwritableKeys) continue;
    issues.push({
      path,
      // The engine's codes are the documented repair vocabulary. Translating
      // them into a second dialect here would give one defect two names.
      code: issue.code,
      message: `${label}${issue.path}: ${issue.message}`,
    });
  }

  issues.push(...kindIssues(doc, path, label, options));
  // The allow-list walk reads node types, which is only safe once the engine
  // has confirmed the tree is well formed. A malformed node would otherwise
  // throw here and turn a rejected document into a server error.
  //
  // "Well formed" is about STRUCTURE, though, and the engine also reports two
  // whole-document verdicts that say nothing about it: the document is too
  // large, or it holds a value JSON cannot write. Neither makes the tree unsafe
  // to walk, and blocking on them costs the author the more useful answer —
  // the engine says a document is unwritable, while this walk says WHICH key.
  //
  // Without this, the two checks answered the same question and the coarser one
  // won purely by running first.
  issues.push(...precise);

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

/**
 * Whether every value in the document survives being stored.
 *
 * `BlockNode.props` is `Record<string, unknown>`, so a server-side or Direct
 * API caller can put anything there. The column is JSON, and the write path
 * stringifies the document on the way in: a bigint throws, while a function,
 * a symbol, or a cycle is dropped or throws instead. Catching it here turns
 * what would be a raw serializer error, or a document silently missing values
 * the caller supplied, into an ordinary rejection naming the key.
 */
function unserializableIssues(
  doc: BlockDocument,
  path: string,
  label: string
): Issue[] {
  const offending = new Set<string>();
  try {
    JSON.stringify(doc, (key, value: unknown) => {
      const type = typeof value;
      if (type === "bigint" || type === "function" || type === "symbol") {
        offending.add(`${key || "(root)"} (${type})`);
        // Replaced so the walk continues and reports every offending key
        // rather than stopping at the first bigint.
        return undefined;
      }
      return value;
    });
  } catch {
    // A cycle is the remaining way stringify fails, and it has no single key
    // to name.
    return [
      {
        path,
        code: "UNSERIALIZABLE_VALUE",
        message: `${label} contains a circular reference and cannot be stored.`,
      },
    ];
  }
  if (offending.size === 0) return [];
  return [
    {
      path,
      code: "UNSERIALIZABLE_VALUE",
      message: `${label} contains values that cannot be stored as JSON: ${[...offending].join(", ")}.`,
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
  // Omitting `allow` permits every registered block; declaring an empty list
  // permits none. Treating the two the same would silently ignore the
  // stricter of the two configurations.
  if (!allow) return [];
  if (!Array.isArray(doc.nodes)) return [];

  const disallowed = new Set<string>();
  walkNodes(doc.nodes, node => {
    if (typeof node.type === "string" && !isAllowed(node.type, allow)) {
      disallowed.add(node.type);
    }
  });
  if (disallowed.size === 0) return [];

  const accepted = allow.length > 0 ? allow.join(", ") : "none";
  return [
    {
      path,
      code: "DISALLOWED_BLOCK_TYPE",
      message: `${label} does not accept ${[...disallowed].sort().join(", ")}. Accepted: ${accepted}.`,
    },
  ];
}

/**
 * Exact name match, or a namespace match for a `namespace/*` pattern.
 *
 * The wildcard binds to the namespace separator rather than to raw characters:
 * `core/*` matches `core/heading` and never `coreevil/banner`. A bare prefix
 * test would quietly admit any namespace that merely starts with the same
 * letters, which is a wider policy than the declaration reads as.
 */
function isAllowed(type: string, allow: readonly string[]): boolean {
  return allow.some(pattern => {
    if (!pattern.endsWith("/*")) return type === pattern;
    return type.startsWith(pattern.slice(0, -1));
  });
}
