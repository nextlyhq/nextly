/**
 * The mark that the default's header (or footer) was filled by the first one
 * an author published: once per area, for good.
 *
 * ## One row per area, and the row is the claim
 *
 * Kept beside the starter's record, as rows of the plugin's own options
 * table, for the reason the record gives (`starter-record`): a field on the
 * settings Single would ask every existing site for a migration. One row per
 * area, so a header's fill and a footer's are separate claims, and the row's
 * unique name decides between two publishes filling the same area at once:
 * the one whose insert lands fills it, and the other changes nothing.
 *
 * ## Who to tell
 *
 * The row also names who published the component, until they have been told:
 * the screen they published from asks for what is waiting for them, and the
 * first ask takes it, in one conditional statement, so a second tab or a
 * second ask is told nothing.
 *
 * @module default-layout/fill-mark
 */
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "../schema/tables";

import type { StarterArea } from "./seed-names";

/** The options-table row each area's mark is kept under. */
const FILL_MARK_OPTION: { readonly [A in StarterArea]: string } = {
  header: "filled-header",
  footer: "filled-footer",
};

/** One area's mark: the component that filled it, and who is still to be told. */
export interface FillMark {
  readonly component: string;
  /** The user to tell, until they have been; null once told, or for nobody. */
  readonly tell: string | null;
}

/** The marks of both areas, absent where that area was never filled. */
export type FillMarks = { readonly [A in StarterArea]?: FillMark };

/** A fill someone is told about: which area, and the component now in it. */
export interface FillToTell {
  readonly area: StarterArea;
  readonly component: string;
}

/** Where the marks are kept. */
export interface FillMarkStore {
  /** Both areas' marks. */
  read(): Promise<FillMarks>;
  /**
   * Mark `area` as filled by `mark.component`. False, writing nothing, when
   * the area is already marked: another fill got there first.
   */
  claim(area: StarterArea, mark: FillMark): Promise<boolean>;
  /** Remove `area`'s mark, only while it is still `mark`. */
  release(area: StarterArea, mark: FillMark): Promise<void>;
  /** Take the fills waiting to be told to `user`: each is answered once. */
  take(user: string): Promise<readonly FillToTell[]>;
}

/** The mark as its row stores it: the component, then who to tell, if anyone. */
export function encodeFillMark(mark: FillMark): string {
  return mark.tell === null ? mark.component : `${mark.component} ${mark.tell}`;
}

/** The row's value as a mark, or null for one this code did not write. */
export function decodeFillMark(value: string): FillMark | null {
  const words = value.split(" ");
  if (words.some(word => word === "")) return null;
  const [component, tell, ...rest] = words;
  if (component === undefined || rest.length > 0) return null;
  return { component, tell: tell ?? null };
}

/** Which database, so a lost race to insert the row is recognised. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The marks, as rows of the plugin's own options table. */
export function fillMarkStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "delete" | "table">,
  dialect: Dialect
): FillMarkStore {
  const named = (area: StarterArea) =>
    eq(db.table(siteOptions).name, FILL_MARK_OPTION[area]);
  // The row only while it still holds `mark`: one statement, so a write made
  // in between by another run is never undone.
  const holding = (area: StarterArea, mark: FillMark) =>
    and(named(area), eq(db.table(siteOptions).value, encodeFillMark(mark))) ??
    named(area);
  const read = async (): Promise<FillMarks> => {
    const found: { -readonly [A in StarterArea]?: FillMark } = {};
    for (const area of ["header", "footer"] as const) {
      const row = (await db.select(siteOptions).where(named(area)).first()) as {
        value?: unknown;
      } | null;
      if (typeof row?.value !== "string") continue;
      // A row this code cannot read still says the area was filled: it is
      // read as filled by no component known, and so is never filled again.
      found[area] = decodeFillMark(row.value) ?? { component: "", tell: null };
    }
    return found;
  };
  return {
    read,
    claim: async (area, mark) => {
      try {
        await db.insert(siteOptions, {
          name: FILL_MARK_OPTION[area],
          value: encodeFillMark(mark),
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(dialect, error)) return false;
        throw error;
      }
    },
    release: async (area, mark) => {
      await db.delete(siteOptions).where(holding(area, mark));
    },
    take: async user => {
      const taken: FillToTell[] = [];
      const marks = await read();
      for (const area of ["header", "footer"] as const) {
        const mark = marks[area];
        if (mark === undefined || mark.tell !== user) continue;
        // The ask that changes the row is the one told; an ask that finds it
        // already changed by another is told nothing.
        const changed = await db
          .update(siteOptions, {
            value: encodeFillMark({ component: mark.component, tell: null }),
          })
          .where(holding(area, mark));
        if (changed > 0) taken.push({ area, component: mark.component });
      }
      return taken;
    },
  };
}
