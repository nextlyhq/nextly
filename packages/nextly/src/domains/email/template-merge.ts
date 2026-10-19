/**
 * Reviewing an owner's update to an overridden template, change by change.
 *
 * Three versions meet here: the BASE the site's override started from, the
 * owner's current version (THEIRS), and the site's (MINE). Each place where
 * the owner changed the base is offered on its own. Where the site edited the
 * same lines, both versions are offered, and the person may pick one or write
 * the result. Lines only the site changed are not the owner's update and stay
 * as the site wrote them.
 *
 * The comparison is by line, per versioned field. Templates are small, so the
 * longest-common-subsequence table is cheap.
 */

import { NextlyError } from "../../errors";
import type { EmailTemplateVersion } from "../../schemas/email-templates/types";

export type VersionField = keyof EmailTemplateVersion;

const FIELDS: ReadonlyArray<VersionField> = [
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
];

/** One change the owner made since the base, with the site's lines beside it. */
export interface OwnerChange {
  /** Stable within one review: the field and the change's position in it. */
  id: string;
  field: VersionField;
  /** True when the site edited the same lines; then `mine` differs from `base`. */
  conflict: boolean;
  /** The base's lines the change replaced (empty for an insertion). */
  base: string[];
  /** The owner's lines now. */
  theirs: string[];
  /** The site's lines at the same place now. */
  mine: string[];
}

/** What the person chose for one change. */
export type OwnerChangeChoice =
  | { use: "mine" }
  | { use: "theirs" }
  | { use: "edited"; text: string };

/** A replaced range: `base[bStart, bEnd)` became `other[oStart, oEnd)`. */
interface Hunk {
  bStart: number;
  bEnd: number;
  oStart: number;
  oEnd: number;
}

function lines(value: string | null): string[] {
  return value === null || value === ""
    ? []
    : value.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * The most cells the line table may have. Past it, the differing middle is
 * offered as one change rather than allocating a table that grows with the
 * square of the template's length.
 */
export const MAX_DIFF_CELLS = 1_000_000;

/**
 * The ranges where `other` differs from `base`. Lines the two share at the
 * start and the end are set aside first; the middle is diffed by a longest
 * common subsequence, or, past MAX_DIFF_CELLS, taken as one change.
 */
function hunks(base: string[], other: string[]): Hunk[] {
  let start = 0;
  while (
    start < base.length &&
    start < other.length &&
    base[start] === other[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < base.length - start &&
    end < other.length - start &&
    base[base.length - 1 - end] === other[other.length - 1 - end]
  ) {
    end++;
  }
  const b = base.slice(start, base.length - end);
  const o = other.slice(start, other.length - end);
  if (b.length === 0 && o.length === 0) return [];
  const middle =
    (b.length + 1) * (o.length + 1) > MAX_DIFF_CELLS
      ? [{ bStart: 0, bEnd: b.length, oStart: 0, oEnd: o.length }]
      : lcsHunks(b, o);
  return middle.map(h => ({
    bStart: h.bStart + start,
    bEnd: h.bEnd + start,
    oStart: h.oStart + start,
    oEnd: h.oEnd + start,
  }));
}

/** The ranges where `other` differs from `base`, from a longest common subsequence. */
function lcsHunks(base: string[], other: string[]): Hunk[] {
  const n = base.length;
  const m = other.length;
  // lcs[i][j]: length of the LCS of base[i:] and other[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        base[i] === other[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | null = null;
  const close = () => {
    if (open) {
      open.bEnd = i;
      open.oEnd = j;
      out.push(open);
      open = null;
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === other[j]) {
      close();
      i++;
      j++;
    } else {
      open ??= { bStart: i, bEnd: i, oStart: j, oEnd: j };
      if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) j++;
      else i++;
    }
  }
  close();
  return out;
}

/** Whether two hunks touch the same base lines. */
function overlaps(a: Hunk, b: Hunk): boolean {
  const aInsert = a.bStart === a.bEnd;
  const bInsert = b.bStart === b.bEnd;
  if (aInsert && bInsert) return a.bStart === b.bStart;
  if (aInsert) return a.bStart > b.bStart && a.bStart < b.bEnd;
  if (bInsert) return b.bStart > a.bStart && b.bStart < a.bEnd;
  return a.bStart < b.bEnd && b.bStart < a.bEnd;
}

interface Region {
  bStart: number;
  bEnd: number;
  theirs: Hunk[];
  mine: Hunk[];
}

/** Group the owner's and the site's hunks into regions of the base. */
function regions(theirs: Hunk[], mine: Hunk[]): Region[] {
  const all = [
    ...theirs.map(h => ({ h, side: "theirs" as const })),
    ...mine.map(h => ({ h, side: "mine" as const })),
  ].sort((a, b) => a.h.bStart - b.h.bStart || a.h.bEnd - b.h.bEnd);
  const out: Region[] = [];
  for (const { h, side } of all) {
    const last = out[out.length - 1];
    const joins =
      last && [...last.theirs, ...last.mine].some(other => overlaps(other, h));
    const region: Region = joins
      ? last
      : { bStart: h.bStart, bEnd: h.bEnd, theirs: [], mine: [] };
    if (!joins) out.push(region);
    region.bStart = Math.min(region.bStart, h.bStart);
    region.bEnd = Math.max(region.bEnd, h.bEnd);
    region[side].push(h);
  }
  return out;
}

/** The lines one side has over a region of the base. */
function sideLines(
  base: string[],
  other: string[],
  side: Hunk[],
  region: Region
): string[] {
  if (side.length === 0) return base.slice(region.bStart, region.bEnd);
  const first = side[0];
  const last = side[side.length - 1];
  const start = first.oStart - (first.bStart - region.bStart);
  const end = last.oEnd + (region.bEnd - last.bEnd);
  return other.slice(start, end);
}

interface FieldMerge {
  field: VersionField;
  base: string[];
  regions: Array<{
    region: Region;
    theirs: string[];
    mine: string[];
    change: OwnerChange | null;
  }>;
}

function mergeField(
  field: VersionField,
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion
): FieldMerge {
  const b = lines(base[field]);
  const t = lines(theirs[field]);
  const m = lines(mine[field]);
  let n = 0;
  return {
    field,
    base: b,
    regions: regions(hunks(b, t), hunks(b, m)).map(region => {
      const theirLines = sideLines(b, t, region.theirs, region);
      const myLines = sideLines(b, m, region.mine, region);
      // Compared line by line: joined, an added blank line reads the same as
      // nothing added.
      const sameEdit =
        theirLines.length === myLines.length &&
        theirLines.every((line, i) => line === myLines[i]);
      // Only a region the owner changed is offered, and not when the site
      // already made exactly the same edit.
      const change: OwnerChange | null =
        region.theirs.length > 0 && !sameEdit
          ? {
              id: `${field}:${n++}`,
              field,
              conflict: region.mine.length > 0,
              base: b.slice(region.bStart, region.bEnd),
              theirs: theirLines,
              mine: myLines,
            }
          : null;
      return { region, theirs: theirLines, mine: myLines, change };
    }),
  };
}

/** Every change the owner made since the base, in field and line order. */
export function ownerChanges(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion
): OwnerChange[] {
  return FIELDS.flatMap(field =>
    mergeField(field, base, theirs, mine).regions.flatMap(r =>
      r.change ? [r.change] : []
    )
  );
}

/**
 * The site's version with the person's choices applied together.
 *
 * Every offered change needs a choice; a missing one is refused rather than
 * defaulted, because either default silently decides for the person.
 */
export function applyOwnerChoices(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  choices: Readonly<Record<string, OwnerChangeChoice>>
): EmailTemplateVersion {
  const result: EmailTemplateVersion = { ...mine };
  const missing: string[] = [];
  const known = new Set<string>();

  for (const field of FIELDS) {
    const merge = mergeField(field, base, theirs, mine);
    const out: string[] = [];
    let at = 0;
    for (const { region, theirs: t, mine: m, change } of merge.regions) {
      out.push(...merge.base.slice(at, region.bStart));
      at = region.bEnd;
      if (!change) {
        // Not offered: the site's lines stand (its own edit, or the same edit).
        out.push(...m);
        continue;
      }
      known.add(change.id);
      const choice = choices[change.id];
      if (!choice) {
        missing.push(change.id);
        out.push(...m);
      } else if (choice.use === "theirs") out.push(...t);
      else if (choice.use === "mine") out.push(...m);
      else out.push(...lines(choice.text));
    }
    out.push(...merge.base.slice(at));
    const joined = out.join("\n");
    if (field === "subject" || field === "htmlContent") result[field] = joined;
    else result[field] = joined === "" ? null : joined;
  }

  const unknown = Object.keys(choices).filter(id => !known.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw NextlyError.validation({
      errors: [
        ...missing.map(id => ({
          path: `choices.${id}`,
          code: "REQUIRED",
          message: "Choose whether to keep your version or use the owner's.",
        })),
        ...unknown.map(id => ({
          path: `choices.${id}`,
          code: "INVALID",
          message: "This change is not part of the update.",
        })),
      ],
      logContext: { missing, unknown },
    });
  }
  return result;
}
