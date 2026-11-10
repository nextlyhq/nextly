/**
 * The media folder added fonts are stored in: one per site, however many
 * server processes add fonts at once.
 *
 * The media library cannot say "one folder of this name": its folder create
 * looks, then inserts, and no index holds names apart. Two calls that both
 * find no folder may both make one, or one's create may be refused because
 * the other's folder appeared between its look and its insert. So the folder is
 * claimed in the plugin's own `page_builder__site_options` table, whose
 * `name` is unique, as the spacing model is (`spacing-mode-store`). The row
 * `fonts-folder` names the folder's id, and only one insert of it can win.
 *
 * A call that finds no claim uses the oldest root "Fonts" folder, or makes
 * one, and claims it. A call that loses the claim uses the winner's folder
 * and deletes the one it made, which is still empty: files are stored only
 * once the folder is settled. A claim naming a folder since deleted is moved
 * to a new one only if the row still names the deleted one, so two calls
 * repairing it at once settle on one folder too.
 *
 * @module site-fonts/folder
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "../schema/tables";

/** The media folder added fonts are stored in. */
export const FONTS_FOLDER = "Fonts";

/** The option row naming the claimed folder's id. */
export const FONTS_FOLDER_OPTION = "fonts-folder";

/** How many times the claim is read and made before the add gives up on it. */
const CLAIM_ATTEMPTS = 3;

/** The plugin's own database surface the claim is kept through. */
export type FontsFolderDatabase = Pick<
  PluginDatabase,
  "select" | "insert" | "update" | "table"
>;

/** Which database, so a lost race to insert the claim is recognised. */
export type FontsFolderDialect = Parameters<typeof isUniqueViolation>[0];

/** The claim on the site's fonts folder. */
export interface FontsFolderClaims {
  /** The claimed folder's id, or `null` when none is claimed. */
  read(): Promise<string | null>;
  /** Claim `id` when nothing is claimed; `false` when another claim holds. */
  claim(id: string): Promise<boolean>;
  /**
   * Move the claim from `was` to `id`; `false` when the row no longer names
   * `was`, another call having moved it first.
   */
  replace(was: string, id: string): Promise<boolean>;
}

/** The claim, kept in the plugin's `site_options` table. */
export function fontsFolderClaims(
  db: FontsFolderDatabase,
  dialect: FontsFolderDialect
): FontsFolderClaims {
  const t = () => db.table(siteOptions);
  const named = () => eq(t().name, FONTS_FOLDER_OPTION);
  return {
    read: async () => {
      const row = await db.select(siteOptions).where(named()).first();
      const value = (row as { value?: unknown } | null)?.value;
      return typeof value === "string" && value !== "" ? value : null;
    },
    claim: async id => {
      try {
        await db.insert(siteOptions, { name: FONTS_FOLDER_OPTION, value: id });
        return true;
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
        return false;
      }
    },
    // Compared and set in one statement, so of two repairs only one moves it.
    // The value always changes (`id` is a new folder's), so MySQL, which
    // counts changed rows rather than matched ones, counts it too.
    replace: async (was, id) => {
      const where = and(named(), eq(t().value, was));
      if (where === undefined) return false;
      return (await db.update(siteOptions, { value: id }).where(where)) === 1;
    },
  };
}

/** A root media folder, as the folder list answers it. */
export interface RootFolder {
  readonly id: string;
  readonly name: string;
  readonly createdAt?: Date | string;
}

/** The media library's root folders, as the claim reads and changes them. */
export interface FontsFolderSource {
  /** The root folders as they are now. */
  list(): Promise<readonly RootFolder[]>;
  /**
   * Make a root "Fonts" folder; `null` when the library refused it because a
   * root "Fonts" folder is there already, which another call made since this
   * one listed the folders.
   */
  create(): Promise<{ id: string } | null>;
  /** Delete a folder this call made, still empty. */
  remove(id: string): Promise<void>;
}

/** When a folder was made, oldest first; one that does not say sorts last. */
function madeAt(folder: RootFolder): number {
  const at =
    folder.createdAt === undefined
      ? Number.NaN
      : new Date(folder.createdAt).getTime();
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * The root "Fonts" folder a claim takes when none is claimed: the oldest,
 * then the lowest id, so calls seeing the same folders take the same one.
 */
function oldestFontsFolder(
  folders: readonly RootFolder[]
): RootFolder | undefined {
  return folders
    .filter(folder => folder.name === FONTS_FOLDER)
    .sort((a, b) => madeAt(a) - madeAt(b) || (a.id < b.id ? -1 : 1))[0];
}

/**
 * Take a folder for an unsettled claim and claim it: the oldest root "Fonts"
 * folder, or one made now. `claimed` is the claim's folder, since deleted, or
 * `null` when nothing is claimed. Answers the folder when this call's claim
 * won, `undefined` when another call's did.
 */
async function claimFolder(
  source: FontsFolderSource,
  claims: FontsFolderClaims,
  claimed: string | null,
  folders: readonly RootFolder[]
): Promise<string | undefined> {
  const existing = oldestFontsFolder(folders);
  const made = existing === undefined ? await source.create() : undefined;
  // A create refused because another call's folder appeared meanwhile: the
  // next try lists that folder and takes it, or the claim made on it.
  if (made === null) return undefined;
  const id = existing?.id ?? made?.id;
  if (id === undefined) return undefined;
  const won =
    claimed === null
      ? await claims.claim(id)
      : await claims.replace(claimed, id);
  if (won) return id;
  // Another call claimed first, perhaps the very folder this one made when
  // it took it as the oldest; only a folder nobody claims is deleted. One
  // left behind is untidy rather than wrong, so a failed delete does not
  // fail the add.
  if (made !== undefined && (await claims.read()) !== made.id) {
    await source.remove(made.id).catch(() => undefined);
  }
  return undefined;
}

/**
 * The site's fonts folder, claimed: the claimed one while it exists, else one
 * taken or made and claimed by this call, else the folder of the call that
 * claimed first. Throws when the claim does not settle in a few tries, which
 * the add answers by storing its files at the library's root.
 */
export async function claimedFontsFolder(
  source: FontsFolderSource,
  claims: FontsFolderClaims
): Promise<string> {
  for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt += 1) {
    // The claim before the folders: a folder is made before it is claimed,
    // so one this read names is in the list below unless it was deleted.
    // The other way round, a folder made and claimed between the two reads
    // would look deleted, and its claim be moved off a live folder.
    const claimed = await claims.read();
    const folders = await source.list();
    if (claimed !== null && folders.some(folder => folder.id === claimed)) {
      return claimed;
    }
    const won = await claimFolder(source, claims, claimed, folders);
    if (won !== undefined) return won;
  }
  throw NextlyError.internal({
    logContext: { reason: "fonts-folder-claim-unsettled" },
  });
}
