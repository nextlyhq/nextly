/**
 * The "unchanged" answer for the admin's metadata reads: an entity tag that is
 * a hash of the body actually sent, so a caller that sends the tag of what it
 * holds (`If-None-Match`) is told `304 Not Modified` instead of being sent the
 * same body again.
 *
 * Made from the body rather than from the inputs the body is made from,
 * because those are many and keep growing: the schema, what the caller may
 * read (permissions, an assignment's expiry, a code-defined read rule deciding
 * on any state at all), a field group's use counts, a removed entity's
 * retirement state read from files and tables. A tag over the body is correct
 * whatever the body depends on: two answers share a tag exactly when they are
 * the same bytes. The read still runs; what is saved is sending it.
 *
 * Only the reads the admin makes again for metadata it may already hold are
 * tagged ({@link METADATA_READS}): the collection, Single and field group
 * lists and schemas. The route marks a successful answer to one of them
 * ({@link markConditional}), and the boundary every response passes
 * ({@link answerConditional}) tags it once its body is final, after the date
 * formatting that boundary applies, so the tag is of what the caller receives.
 *
 * @module route-handler/metadata-etag
 */
import { createHash } from "node:crypto";

/**
 * The metadata reads an "unchanged" answer may stand for, as
 * `<service>.<method>`.
 */
const METADATA_READS: ReadonlySet<string> = new Set([
  "collections.listCollections",
  "collections.getCollection",
  "singles.listSingles",
  "singles.getSingleSchema",
  "field-groups.listComponents",
  "field-groups.getComponent",
]);

/**
 * The internal header a route puts on a response the boundary may answer
 * "unchanged"; the boundary removes it, so no caller ever receives it.
 */
const CONDITIONAL_HEADER = "x-nextly-conditional";

/**
 * Mark `response`, the answer to `<service>.<method>`, as one the boundary
 * may answer "unchanged": only a metadata read's successful answer is marked.
 */
export function markConditional(
  service: string,
  method: string,
  response: Response
): void {
  if (response.status !== 200) return;
  if (!METADATA_READS.has(`${service}.${method}`)) return;
  response.headers.set(CONDITIONAL_HEADER, "1");
}

/** The weak tag of `body`: the same bytes, the same tag. */
function tagOf(body: string): string {
  // Weak: it says the answers are the same, which is all `If-None-Match` asks.
  return `W/"${createHash("sha1").update(body).digest("base64url")}"`;
}

/**
 * Whether the request's `If-None-Match` names `etag`, compared weakly as the
 * header is (RFC 9110, 13.1.2): any listed tag equal to it once a `W/`
 * prefix is set aside.
 *
 * `*` is not honoured: it asks whether any answer exists, which says nothing
 * about whether the caller holds this one.
 */
function holdsTag(req: Request, etag: string): boolean {
  const header = req.headers.get("if-none-match");
  if (header === null) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  const wanted = opaque(etag);
  return header.split(",").some(tag => opaque(tag) === wanted);
}

/**
 * The response as the caller receives it: an unmarked one as it is; a marked
 * one with its tag (`ETag`), or, where the request holds that tag,
 * `304 Not Modified` with the tag and no body. Every other header is kept,
 * so a signed-in answer stays private and varies as it did.
 */
export async function answerConditional(
  req: Request,
  response: Response
): Promise<Response> {
  if (!response.headers.has(CONDITIONAL_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(CONDITIONAL_HEADER);
  const body = await response.text();
  const etag = tagOf(body);
  headers.set("ETag", etag);
  if (holdsTag(req, etag)) {
    // A 304 carries no body, so nothing describing one.
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
