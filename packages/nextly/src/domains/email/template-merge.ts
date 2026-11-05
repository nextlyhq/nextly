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

import { stable } from "./template-ownership";
import { compileWrittenHtml, compileWrittenText } from "./written/compile";
import { describeBlocks } from "./written/describe";
import type { WrittenBlock, WrittenDocument } from "./written/document";
import { parseWrittenDocument } from "./written/fields";

export type VersionField = keyof EmailTemplateVersion;

const FIELDS: ReadonlyArray<VersionField> = [
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
];

/**
 * The fields a written template's review compares by line. Its HTML and
 * plain text are written from its blocks, which are compared block by block.
 */
const WRITTEN_FIELDS: ReadonlyArray<VersionField> = ["subject", "preheader"];

/** How the owner changed a run of blocks. */
export type BlockChangeKind = "insert" | "delete" | "change" | "move";

/** One change the owner made since the base, with the site's lines beside it. */
export interface OwnerChange {
  /** Stable within one review: the field and the change's position in it. */
  id: string;
  /**
   * The field the change is in; `"blocks"` (`@experimental`) for a change to
   * a written template's blocks; or `"template"` (`@experimental`) for an
   * update offered as a whole, whose lines show every field it replaces.
   */
  field: VersionField | "blocks" | "template";
  /** True when the site edited the same lines; then `mine` differs from `base`. */
  conflict: boolean;
  /**
   * The base's lines the change replaced (empty for an insertion). For a
   * change to blocks, the blocks in plain words, one line each.
   */
  base: string[];
  /** The owner's lines now. */
  theirs: string[];
  /** The site's lines at the same place now. */
  mine: string[];
  /**
   * @experimental For a change to blocks: what the owner did to them (a
   * moved block is one change, taken or kept in both places together).
   */
  kind?: BlockChangeKind;
  /** @experimental For a change to blocks: the blocks themselves. */
  blocks?: {
    base: WrittenBlock[];
    theirs: WrittenBlock[];
    mine: WrittenBlock[];
  };
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

/** The three-way merge of one sequence: a field's lines, or a template's blocks. */
interface SequenceMerge {
  base: string[];
  regions: Array<{
    region: Region;
    theirs: string[];
    mine: string[];
    /** The owner changed it, and the site didn't make exactly the same edit. */
    offered: boolean;
  }>;
}

/**
 * Each region of the base the owner or the site changed, with each side's
 * items over it. Only a region the owner changed is offered, and not when the
 * site already made exactly the same edit.
 */
function mergeSequence(b: string[], t: string[], m: string[]): SequenceMerge {
  return {
    base: b,
    regions: regions(hunks(b, t), hunks(b, m)).map(region => {
      const theirs = sideLines(b, t, region.theirs, region);
      const mine = sideLines(b, m, region.mine, region);
      // Compared item by item: joined, an added blank line reads the same as
      // nothing added.
      const sameEdit = sameItems(theirs, mine);
      return {
        region,
        theirs,
        mine,
        offered: region.theirs.length > 0 && !sameEdit,
      };
    }),
  };
}

function sameItems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
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
  const merge = mergeSequence(
    lines(base[field]),
    lines(theirs[field]),
    lines(mine[field])
  );
  let n = 0;
  return {
    field,
    base: merge.base,
    regions: merge.regions.map(({ region, theirs: t, mine: m, offered }) => ({
      region,
      theirs: t,
      mine: m,
      change: offered
        ? {
            id: `${field}:${n++}`,
            field,
            conflict: region.mine.length > 0,
            base: merge.base.slice(region.bStart, region.bEnd),
            theirs: t,
            mine: m,
          }
        : null,
    })),
  };
}

/** Every change the owner made since the base, in field and line order. */
export function ownerChanges(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  fields: ReadonlyArray<VersionField> = FIELDS
): OwnerChange[] {
  return fields.flatMap(field =>
    mergeField(field, base, theirs, mine).regions.flatMap(r =>
      r.change ? [r.change] : []
    )
  );
}

/** The changes a review has met, and those it found no usable choice for. */
interface Seen {
  known: Set<string>;
  missing: string[];
  /** Changes given written text, which a change to blocks takes none of. */
  unwritable: string[];
}

const seen = (): Seen => ({ known: new Set(), missing: [], unwritable: [] });

/** The fields of the site's version with the person's choices applied. */
function applyFields(
  fields: ReadonlyArray<VersionField>,
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  choices: Readonly<Record<string, OwnerChangeChoice>>,
  met: Seen
): EmailTemplateVersion {
  const result: EmailTemplateVersion = { ...mine };
  for (const field of fields) {
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
      met.known.add(change.id);
      const choice = choices[change.id];
      if (!choice) {
        met.missing.push(change.id);
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
  return result;
}

/** Refuse a review that left a change undecided, or decided one it wasn't offered. */
function refuseChoices(
  choices: Readonly<Record<string, OwnerChangeChoice>>,
  met: Seen
): void {
  const unknown = Object.keys(choices).filter(id => !met.known.has(id));
  const { missing, unwritable } = met;
  if (missing.length + unknown.length + unwritable.length === 0) return;
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
      ...unwritable.map(id => ({
        path: `choices.${id}`,
        code: "INVALID",
        message:
          "Keep your blocks or use the owner's: blocks aren't written by hand here.",
      })),
    ],
    logContext: { missing, unknown, unwritable },
  });
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
  const met = seen();
  const result = applyFields(FIELDS, base, theirs, mine, choices, met);
  refuseChoices(choices, met);
  return result;
}

/** Each block as one canonical item, so blocks are compared by what they say. */
const blockKeys = (blocks: ReadonlyArray<WrittenBlock>): string[] =>
  blocks.map(block => stable(block));
const blocksOf = (keys: ReadonlyArray<string>): WrittenBlock[] =>
  keys.map(key => JSON.parse(key) as WrittenBlock);

/** A run of the base the owner or the site changed, as blocks are reviewed. */
interface BlockRegion {
  bStart: number;
  bEnd: number;
  theirs: string[];
  mine: string[];
  /** The owner changed it, and the site didn't make exactly the same edit. */
  offered: boolean;
  /** The site changed it since the base. */
  siteChanged: boolean;
}

/**
 * The merge's regions, block for block where it can be: a region where the
 * base, the owner and the site have the same number of blocks is one region
 * per block, so a block only the site changed is never offered beside one
 * the owner changed next to it.
 */
function blockRegions(merge: SequenceMerge): BlockRegion[] {
  return merge.regions.flatMap(({ region, theirs, mine, offered }) => {
    const base = merge.base.slice(region.bStart, region.bEnd);
    if (
      base.length > 1 &&
      theirs.length === base.length &&
      mine.length === base.length
    ) {
      return base.map((block, k) => ({
        bStart: region.bStart + k,
        bEnd: region.bStart + k + 1,
        theirs: [theirs[k]],
        mine: [mine[k]],
        offered: theirs[k] !== block && theirs[k] !== mine[k],
        siteChanged: mine[k] !== block,
      }));
    }
    return [
      {
        bStart: region.bStart,
        bEnd: region.bEnd,
        theirs,
        mine,
        offered,
        siteChanged: region.mine.length > 0,
      },
    ];
  });
}

interface BlockMerge {
  base: string[];
  regions: BlockRegion[];
  /** The change each offered region is part of, by its index in `regions`. */
  changeOf: Map<number, OwnerChange>;
  changes: OwnerChange[];
}

function blockChangeKind(
  region: BlockRegion
): Exclude<BlockChangeKind, "move"> {
  if (region.bEnd === region.bStart) return "insert";
  return region.theirs.length === 0 ? "delete" : "change";
}

/**
 * The owner's changes to the blocks, one per region it changed. A block it
 * moved (removed in one place, the same block added in another, the site
 * having touched neither) is one change for both places, so taking half of
 * it can neither drop the block nor send it twice.
 */
function mergeBlocks(
  base: ReadonlyArray<WrittenBlock>,
  theirs: ReadonlyArray<WrittenBlock>,
  mine: ReadonlyArray<WrittenBlock>
): BlockMerge {
  const merge = mergeSequence(
    blockKeys(base),
    blockKeys(theirs),
    blockKeys(mine)
  );
  const regions = blockRegions(merge);
  const offered = regions.flatMap((r, i) => (r.offered ? [i] : []));
  const removed = (i: number) =>
    merge.base.slice(regions[i].bStart, regions[i].bEnd);

  const partner = new Map<number, number>();
  for (const out of offered) {
    if (
      blockChangeKind(regions[out]) !== "delete" ||
      regions[out].siteChanged
    ) {
      continue;
    }
    const into = offered.find(
      i =>
        !partner.has(i) &&
        blockChangeKind(regions[i]) === "insert" &&
        !regions[i].siteChanged &&
        sameItems(regions[i].theirs, removed(out))
    );
    if (into !== undefined) {
      partner.set(out, into);
      partner.set(into, out);
    }
  }

  const changeOf = new Map<number, OwnerChange>();
  const changes: OwnerChange[] = [];
  for (const i of offered) {
    if (changeOf.has(i)) continue;
    const r = regions[i];
    const other = partner.get(i);
    let sides: NonNullable<OwnerChange["blocks"]>;
    if (other === undefined) {
      sides = {
        base: blocksOf(removed(i)),
        theirs: blocksOf(r.theirs),
        mine: blocksOf(r.mine),
      };
    } else {
      const moved = blocksOf(
        blockChangeKind(r) === "delete" ? removed(i) : r.theirs
      );
      sides = { base: moved, theirs: moved, mine: moved };
    }
    const change: OwnerChange = {
      id: `blocks:${changes.length}`,
      field: "blocks",
      kind: other === undefined ? blockChangeKind(r) : "move",
      conflict: other === undefined && r.siteChanged,
      base: describeBlocks(sides.base),
      theirs: describeBlocks(sides.theirs),
      mine: describeBlocks(sides.mine),
      blocks: sides,
    };
    changeOf.set(i, change);
    if (other !== undefined) changeOf.set(other, change);
    changes.push(change);
  }
  return { base: merge.base, regions, changeOf, changes };
}

/** The site's blocks with the person's choices applied. */
function applyBlocks(
  merge: BlockMerge,
  choices: Readonly<Record<string, OwnerChangeChoice>>,
  met: Seen
): WrittenBlock[] {
  const out: string[] = [];
  let at = 0;
  merge.regions.forEach((r, i) => {
    out.push(...merge.base.slice(at, r.bStart));
    at = r.bEnd;
    const change = merge.changeOf.get(i);
    if (!change) {
      // Not offered: the site's blocks stand.
      out.push(...r.mine);
      return;
    }
    // A move is met twice, once in each place; it is decided once.
    const first = !met.known.has(change.id);
    met.known.add(change.id);
    const choice = choices[change.id];
    if (choice?.use === "theirs") {
      out.push(...r.theirs);
      return;
    }
    if (first && !choice) met.missing.push(change.id);
    if (first && choice?.use === "edited") met.unwritable.push(change.id);
    out.push(...r.mine);
  });
  out.push(...merge.base.slice(at));
  return blocksOf(out);
}

/** The blocks a written template's review compares: the base's, the owner's and the site's. */
export interface ReviewedBlocks {
  base: WrittenDocument;
  theirs: WrittenDocument;
  mine: WrittenDocument;
}

/**
 * Every change the owner made to a written template since the base: its
 * subject and preview line, line by line, and its blocks, block by block.
 */
export function writtenOwnerChanges(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  blocks: ReviewedBlocks
): OwnerChange[] {
  return [
    ...ownerChanges(base, theirs, mine, WRITTEN_FIELDS),
    ...mergeBlocks(blocks.base.blocks, blocks.theirs.blocks, blocks.mine.blocks)
      .changes,
  ];
}

/**
 * The site's written version with the person's choices applied together:
 * its subject and preview line, and its blocks, with its HTML and plain text
 * written from the blocks that result. Refused as a line review is, and for
 * written text on a change to blocks, which takes none.
 */
export function applyWrittenChoices(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  blocks: ReviewedBlocks,
  choices: Readonly<Record<string, OwnerChangeChoice>>
): { version: EmailTemplateVersion; blocks: WrittenDocument } {
  const met = seen();
  const text = applyFields(WRITTEN_FIELDS, base, theirs, mine, choices, met);
  const merge = mergeBlocks(
    blocks.base.blocks,
    blocks.theirs.blocks,
    blocks.mine.blocks
  );
  const result = applyBlocks(merge, choices, met);
  refuseChoices(choices, met);
  // Checked as a save is: both sides adding blocks can pass the limit.
  const merged = parseWrittenDocument({ version: 1, blocks: result });
  return {
    version: {
      ...text,
      htmlContent: compileWrittenHtml(merged),
      plainTextContent: compileWrittenText(merged),
    },
    blocks: merged,
  };
}

/**
 * The id of the one change an owner's update is offered as when the template
 * is written in blocks on either side.
 */
export const WHOLE_TEMPLATE = "template";

/**
 * An owner's update offered whole: one change showing each side's HTML,
 * decided at once as the site's version or the owner's. For a template
 * written in blocks on either side: lines of HTML written from blocks are no
 * one's to merge, and a version that took some of them would no longer be
 * the blocks it says it is.
 */
export function wholeTemplateChange(
  base: EmailTemplateVersion,
  theirs: EmailTemplateVersion,
  mine: EmailTemplateVersion,
  edited = false
): OwnerChange {
  return {
    id: WHOLE_TEMPLATE,
    field: "template",
    // Whether the site edited its version since the base: taking the
    // owner's then replaces that edit. It is still taken or kept whole.
    conflict: edited,
    base: wholeLines(base),
    theirs: wholeLines(theirs),
    mine: wholeLines(mine),
  };
}

/**
 * Every field of a version, each named, so taking it whole is taken seeing
 * all it replaces: a subject or a preview line can change with no HTML moving.
 */
function wholeLines(version: EmailTemplateVersion): string[] {
  const plain = lines(version.plainTextContent);
  return [
    `Subject: ${version.subject}`,
    ...(version.preheader ? [`Preview text: ${version.preheader}`] : []),
    "HTML:",
    ...lines(version.htmlContent),
    ...(plain.length > 0 ? ["Plain text:", ...plain] : []),
  ];
}

/**
 * Which version a review of a whole template keeps. `offered` is whether the
 * comparison offered the change; when it didn't, the site's version stands
 * and no choice is asked for. A missing or unknown choice is refused as a
 * line review's is, and so is written text: there are no lines to write.
 */
export function wholeTemplateChoice(
  choices: Readonly<Record<string, OwnerChangeChoice>>,
  offered: boolean
): "mine" | "theirs" {
  const path = `choices.${WHOLE_TEMPLATE}`;
  const choice = offered ? choices[WHOLE_TEMPLATE] : undefined;
  const unknown = Object.keys(choices).filter(
    id => !offered || id !== WHOLE_TEMPLATE
  );
  const errors = unknown.map(id => ({
    path: `choices.${id}`,
    code: "INVALID",
    message: "This change is not part of the update.",
  }));
  if (offered && !choice) {
    errors.push({
      path,
      code: "REQUIRED",
      message: "Choose whether to keep your version or use the owner's.",
    });
  } else if (choice?.use === "edited") {
    errors.push({
      path,
      code: "INVALID",
      message:
        "Keep your version or use the owner's: this template is reviewed as a whole.",
    });
  }
  if (errors.length > 0) {
    throw NextlyError.validation({ errors, logContext: { unknown } });
  }
  return choice?.use === "theirs" ? "theirs" : "mine";
}
