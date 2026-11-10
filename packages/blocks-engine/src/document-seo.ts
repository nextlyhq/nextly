/**
 * A document's own metadata, with its bindings filled: the title,
 * description and social image an author set on the document itself, as
 * opposed to what its blocks offer (`derive-seo`).
 *
 * Its reason to exist is the collection template. One template draws every
 * entry of its collection, so a metadata value written as plain text would
 * give every entry's page the same title. A text value is therefore a
 * sequence of segments, each literal text or a binding, joined in order: an
 * entry's title followed by the site's name is
 * `[{ $bind: "title" }, " | ", { $bind: "applicationName", source: "site" }]`.
 * It is data, never a template string: nothing is parsed out of the literal
 * text, and a binding is the same typed path a block's prop takes.
 *
 * Bindings are filled by the page's binding pass, through the same checks,
 * fallbacks and formats a prop's are, against a text prop, so a value that
 * would not fit a heading's text cannot reach a page's title either. A social
 * image binds to a media field or a URL field, as an image prop does.
 *
 * Total: a value of any shape gives an answer, never a throw.
 *
 * @module document-seo
 */
import type { BindingIssue } from "./binding-issues";
import type { CheckedBinding } from "./binding-rules";
import type { SeoImageCandidate } from "./derive-seo";
import {
  MAX_SEO_SEGMENTS,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { isPlainRecord } from "./plain-record";
import {
  boundSourceValue,
  resolveNodeBindings,
  type BindingRun,
} from "./resolve-bindings";
import { ownEntry } from "./safe-record";
import { checkSeoBinding } from "./seo-binding-check";

/** The document's metadata, filled, with only the parts that produced one. */
export interface ResolvedDocumentSeo {
  readonly title?: string;
  readonly description?: string;
  readonly image?: SeoImageCandidate;
  /** What went wrong filling a binding, as a block's binding issues report it. */
  readonly issues: readonly BindingIssue[];
}

/** The node type a segment is filled as; no block of this type exists. */
const SEGMENT_TYPE = "nextly/seo-segment";

/** The one prop a segment fills. */
const SEGMENT_PROP = "value";

/**
 * Fill a document's metadata.
 *
 * `run` is the page's binding pass; without one (a page that reads no
 * source), a binding fills its fallback and literal text stands as written.
 */
export function resolveDocumentSeo(
  document: BlockDocument,
  run: BindingRun | undefined
): ResolvedDocumentSeo {
  const seo = documentSeoOf(document);
  if (seo === undefined) return { issues: [] };
  const issues: BindingIssue[] = [];
  const title = joinedText(ownEntry(seo, "title"), "title", run, issues);
  const description = joinedText(
    ownEntry(seo, "description"),
    "description",
    run,
    issues
  );
  const image = imageOf(ownEntry(seo, "image"), run, issues);
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
    issues,
  };
}

/** The document's `settings.seo` record, or nothing when it holds none. */
function documentSeoOf(
  document: BlockDocument
): Readonly<Record<string, unknown>> | undefined {
  const settings: unknown = isPlainRecord(document)
    ? ownEntry(document, "settings")
    : undefined;
  const seo = isPlainRecord(settings) ? ownEntry(settings, "seo") : undefined;
  return isPlainRecord(seo) ? seo : undefined;
}

/**
 * The segments of a text value joined, trimmed, or nothing when they come to
 * no text: a page with an empty title falls back to whatever else names it.
 */
function joinedText(
  value: unknown,
  field: string,
  run: BindingRun | undefined,
  issues: BindingIssue[]
): string | undefined {
  if (!Array.isArray(value)) return undefined;
  let text = "";
  // A stored document may hold more than a save allows: only as many
  // segments as a save would accept are read, so its size bounds no work.
  const read = Math.min(value.length, MAX_SEO_SEGMENTS);
  for (let index = 0; index < read; index += 1) {
    const segment: unknown = value[index];
    if (typeof segment === "string") {
      text += segment;
      continue;
    }
    const filled = filledSegment(segment, `seo:${field}:${String(index)}`, run);
    for (const issue of filled.issues) issues.push(issue);
    if (typeof filled.value === "string") text += filled.value;
  }
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The props lookup a segment is filled against: one text prop. */
const SEGMENT_PROPS: BindingRun["props"] = {
  get: type =>
    type === SEGMENT_TYPE
      ? { props: { [SEGMENT_PROP]: { type: "text" } } }
      : undefined,
};

/**
 * One bound segment, filled as a text prop is, by the block binding pass
 * itself: the same checks, fallback and format, so a segment and a heading
 * bound to one field show the same text.
 */
function filledSegment(
  binding: unknown,
  id: string,
  run: BindingRun | undefined
): { readonly value: unknown; readonly issues: readonly BindingIssue[] } {
  const node: BlockNode = {
    id,
    type: SEGMENT_TYPE,
    version: 1,
    props: { [SEGMENT_PROP]: "" },
    bindings: { [SEGMENT_PROP]: binding } as BlockNode["bindings"],
  };
  if (run === undefined) {
    const fallback = isPlainRecord(binding)
      ? ownEntry(binding, "fallback")
      : undefined;
    return { value: fallback, issues: [] };
  }
  const filled = resolveNodeBindings(
    node,
    { ...run, props: SEGMENT_PROPS },
    { phase: "page" }
  );
  return { value: filled.props[SEGMENT_PROP], issues: filled.issues };
}

/**
 * The social image a binding gives, as a candidate the caller resolves in
 * order with the blocks' own: from a media field, the media (its address when
 * the read populated it, its id otherwise); from a URL field, the address. An
 * address is still judged by the caller's scheme and host checks, as an
 * image block's is. Checked by the same rule a save is (`seo-binding-check`).
 */
function imageOf(
  binding: unknown,
  run: BindingRun | undefined,
  issues: BindingIssue[]
): SeoImageCandidate | undefined {
  if (!isPlainRecord(binding)) return undefined;
  if (run === undefined) return unreadImageOf(binding);
  const checked = checkSeoBinding({
    binding,
    place: "image",
    id: IMAGE_ID,
    ...(run.schema === undefined ? {} : { schema: run.schema }),
    ...(run.entryRef === undefined ? {} : { refs: { entry: run.entryRef } }),
  });
  for (const issue of checked.issues) issues.push(issue);
  if (checked.outcome === "ignore") return undefined;
  if (checked.outcome === "fallback") {
    return candidateOf(checked.fallback?.value);
  }
  // A fallback is read by the kind of field the binding ended at, as its
  // value is: a URL field's fallback is an address, whatever it looks like.
  const kind = checked.binding.kind;
  const fallback = () => candidateOf(checked.binding.fallback?.value, kind);
  const read = boundSourceValue(checked.binding, run, { phase: "page" });
  if (!read.read) {
    // Reported as a block's binding to an unread source is, so a refused
    // read is told apart from an image the entry does not have.
    issues.push(
      imageIssue(
        checked.binding.path,
        "binding-source-unavailable",
        `This binding's ${checked.binding.source} source was not read for this page.`
      )
    );
    return fallback();
  }
  // A URL field's value is an address. Anything else stored there, a media
  // object included, is a value of the wrong type, not an image.
  if (
    kind === "link" &&
    read.value !== undefined &&
    read.value !== null &&
    typeof read.value !== "string"
  ) {
    issues.push(
      imageIssue(
        checked.binding.path,
        "binding-type-misfit",
        "This binding's value is not an address, so its fallback is shown."
      )
    );
    return fallback();
  }
  return candidateOf(read.value, kind) ?? fallback();
}

/**
 * The social image of a page whose bindings were not read: the binding's
 * fallback, judged by the same check a save is, by its shape alone, so it is
 * an image address and never a media id a save would refuse.
 */
function unreadImageOf(binding: unknown): SeoImageCandidate | undefined {
  const checked = checkSeoBinding({ binding, place: "image", id: IMAGE_ID });
  if (checked.outcome === "ignore") return undefined;
  const fallback =
    checked.outcome === "fallback"
      ? checked.fallback
      : checked.binding.fallback;
  return candidateOf(fallback?.value);
}

/** Names the document's social image in its issues. */
const IMAGE_ID = "seo:image";

/** An issue with the document's social image binding. */
function imageIssue(
  path: string,
  code: BindingIssue["code"],
  message: string
): BindingIssue {
  return { nodeId: IMAGE_ID, prop: "value", code, message, path };
}

/** An address rather than a media id: absolute over HTTP, or a path on the site. */
const ADDRESS = /^(?:https?:\/\/|\/)/i;

/**
 * A stored value as an image candidate: a populated media object by its
 * address, a URL field's value as an address, and otherwise an id the
 * caller's media reader looks up.
 */
function candidateOf(
  value: unknown,
  kind?: CheckedBinding["kind"]
): SeoImageCandidate | undefined {
  if (isPlainRecord(value)) {
    // A populated media record by its address; one read without a usable
    // address by its id, which the caller's media reader can still resolve.
    const url = ownEntry(value, "url");
    if (typeof url === "string" && url.trim() !== "") {
      return { kind: "url", value: url.trim() };
    }
    const id = ownEntry(value, "id");
    if (typeof id === "string" && id.trim() !== "") {
      return { kind: "media", value: id.trim() };
    }
    return typeof id === "number" && Number.isFinite(id)
      ? { kind: "media", value: String(id) }
      : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { kind: "media", value: String(value) };
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const text = value.trim();
  if (kind === "link" || ADDRESS.test(text)) {
    return { kind: "url", value: text };
  }
  return { kind: "media", value: text };
}
