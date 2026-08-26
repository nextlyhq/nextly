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
 * Read the parameter's value, saying which of the three answers it is.
 *
 * `false` values are dropped rather than honoured. The read path filters them
 * out before applying the projection, so `{"title":false}` selected nothing
 * while still counting as a selection — and a projection that selects nothing
 * returns the whole document. A caller who wrote it meaning "everything except
 * the title" got the exact opposite.
 */
export function readSelectParam(raw: string | undefined): SelectRequest {
  if (raw === undefined || raw.trim() === "") return { kind: "all" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "unreadable",
      reason:
        'select must be a JSON object naming fields, such as {"title":true}',
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      kind: "unreadable",
      reason:
        'select must be a JSON OBJECT naming fields, such as {"title":true}',
    };
  }

  const fields: Record<string, true> = {};
  for (const [name, wanted] of Object.entries(parsed)) {
    if (wanted === true) fields[name] = true;
  }

  if (Object.keys(fields).length === 0) {
    return {
      kind: "unreadable",
      reason: "select named no fields to return; omit it to return every field",
    };
  }

  return { kind: "fields", fields };
}
