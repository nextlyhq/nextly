/**
 * What `--accept-data-loss` says in every command's help. A module of its own
 * that imports nothing, so a command declares the option without loading the
 * consent's checks; `data-loss-consent` re-exports it.
 */
export const ACCEPT_DATA_LOSS_HELP =
  "Consent to deleting data. Alone it covers every deletion and lists each " +
  "one first; given tables and table.column pairs " +
  "(--accept-data-loss=posts,pages.summary) it covers only those. " +
  "Same as NEXTLY_ACCEPT_DATA_LOSS.";
