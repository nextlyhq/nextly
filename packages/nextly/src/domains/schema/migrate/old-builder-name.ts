/**
 * The name an earlier Schema Builder gave its migration files, part (a) of
 * the signature `old-builder-files` reads them by. A module that imports
 * nothing, so a reader that only needs to know whether a folder could hold
 * such a file (`withNextly`, while Next.js loads `next.config`) asks it
 * without loading the classification, which does; the classification reads
 * the name through this same pattern.
 *
 * @module domains/schema/migrate/old-builder-name
 */

/** (a): the timestamp, the verb and the rest of the name the Builder gave it. */
export const BUILDER_FILE_NAME: RegExp =
  /^\d{13}_(create|update|i18n|status|drop)_(.+)\.sql$/;

/**
 * Whether a file name is one an earlier Schema Builder gave, part (a) of the
 * signature: the files worth reading to classify, and the only ones the
 * classification can set aside.
 */
export function hasOldBuilderName(name: string): boolean {
  return BUILDER_FILE_NAME.test(name);
}
