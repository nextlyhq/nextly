/**
 * The query-parameter formats, read and written by one piece of code.
 *
 * A leaf: no server imports, so a browser bundle reaching `nextly/query` does
 * not pull the Direct API graph behind it.
 *
 * `select` lives here because it had a reader and no writer, and every caller
 * that needed to write one worked the format out for itself — four
 * implementations, two of which disagreed. `sort` and `where` have the same
 * shape today, spelled out again in the admin's API Playground; they belong
 * here too, and are deliberately left for their own change rather than moved
 * in passing.
 *
 * @module query
 */

export {
  encodeSelectParam,
  readSelectParam,
  type SelectRequest,
} from "./select-param";
