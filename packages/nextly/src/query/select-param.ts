/**
 * The `select` query parameter, read and written in one place.
 *
 * It is a JSON object naming the fields a caller wants — `{"title":true}` —
 * and nothing else is accepted. That was never written down anywhere a caller
 * could find it, and the format had a reader and no writer, so every caller
 * worked it out for itself: the admin's API Playground rediscovered it by
 * probing a running server and recorded the answer in a comment; the form
 * builder guessed a comma list, shipped it, and downloaded every field of up
 * to fifty documents per collection to fill a dropdown reading five.
 *
 * Neither caller was told. A request the reader could not understand was
 * answered with the whole document, which looks exactly like a request that
 * asked for the whole document.
 *
 * Client-safe by construction: no imports, no Node built-ins, reachable from a
 * browser bundle through `nextly/query` without pulling the server graph.
 *
 * @module query/select-param
 */

/**
 * What a caller asked for.
 *
 * Three answers rather than a nullable map, because the absent case and the
 * unreadable case want opposite treatment and used to be the same value. "No
 * projection was requested" is a caller getting what they asked for; "I could
 * not read your projection" is a caller getting the opposite of what they
 * asked for, silently and at the cost of every field of every row.
 */
export type SelectRequest =
  | { kind: "all" }
  | { kind: "fields"; fields: Record<string, true> }
  | { kind: "unreadable"; reason: string };

/**
 * Write the parameter's VALUE. Encoding it for a URL is the caller's job —
 * pass it through `URLSearchParams`, or `encodeURIComponent` when building a
 * query string by hand.
 *
 * An empty list yields an empty string, which callers drop rather than send:
 * a projection naming no fields cannot be honoured, and sending one would be
 * asking for everything by a route that reads as asking for nothing.
 */
export function encodeSelectParam(fields: readonly string[]): string {
  const named = fields.filter(field => field.length > 0);
  if (named.length === 0) return "";
  return JSON.stringify(Object.fromEntries(named.map(field => [field, true])));
}

/**
 * Characters that cannot occur in a field name and do occur in the other
 * spellings of this parameter.
 *
 * A rejection set rather than an acceptance pattern, deliberately. Three
 * different field-name patterns already exist in this repository and one of
 * them disagrees with the other two, so a fourth would be a fourth thing to
 * drift — and the direction that drift fails in matters here: this reader
 * REFUSES what it does not accept, so a pattern stricter than the config
 * validator's would reject a select naming a field the config allows. A set of
 * characters no field name can contain cannot make that mistake.
 */
const NOT_IN_A_FIELD_NAME = /[{}[\]":\s]/;

function unreadable(reason: string): SelectRequest {
  return { kind: "unreadable", reason };
}

/**
 * The comma-separated form, which is the one the REST reference documents:
 * `?select=id,title,publishedAt`.
 *
 * It has never worked. The reader accepted only a JSON object, so the
 * documented request was parsed as nothing, discarded, and answered with every
 * field — which is why the one caller that followed the documentation shipped a
 * projection that projected nothing, and why the admin's API Playground had to
 * probe a running server to find the form that does work.
 */
function fromCommaList(value: string): SelectRequest {
  const names = value.split(",").map(name => name.trim());
  if (names.some(name => name === "" || NOT_IN_A_FIELD_NAME.test(name))) {
    return unreadable(
      "select must be a comma-separated list of field names, such as " +
        '"id,title", or a JSON object naming them, such as {"title":true}'
    );
  }
  return {
    kind: "fields",
    fields: Object.fromEntries(names.map(n => [n, true])),
  };
}

/**
 * The JSON object form: `{"title":true}`.
 *
 * EVERY entry has to be a boolean. Skipping the ones that are not would accept
 * `{"title":true,"body":"yes"}` as a valid projection over `title` alone —
 * quietly answering a different question than the caller asked, which is the
 * defect this module exists to remove rather than relocate.
 */
function fromFieldMap(map: Record<string, unknown>): SelectRequest {
  const fields: Record<string, true> = {};
  for (const [name, wanted] of Object.entries(map)) {
    if (typeof wanted !== "boolean") {
      return unreadable(
        `select values must be true or false; the value for "${name}" is neither`
      );
    }
    if (wanted) fields[name] = true;
  }

  if (Object.keys(fields).length === 0) {
    return unreadable(
      "select named no fields to return; omit it to return every field"
    );
  }
  return { kind: "fields", fields };
}

/**
 * Read the parameter's value, saying which of the three answers it is.
 *
 * Both documented spellings are accepted. Which one a value is gets decided by
 * whether it is JSON at all, rather than by looking for a comma: a JSON object
 * containing one is still JSON.
 *
 * `false` entries select nothing, because the read path filters them out before
 * applying the projection — so `{"title":false}` counted as a selection, chose
 * no field, and a projection choosing nothing returns the whole document. A
 * caller who wrote it meaning "everything except the title" got the opposite.
 */
export function readSelectParam(raw: string | undefined): SelectRequest {
  if (raw === undefined || raw.trim() === "") return { kind: "all" };
  const value = raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fromCommaList(value);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return unreadable(
      "select must be a comma-separated list of field names, such as " +
        '"id,title", or a JSON object naming them, such as {"title":true}'
    );
  }

  return fromFieldMap(parsed as Record<string, unknown>);
}
