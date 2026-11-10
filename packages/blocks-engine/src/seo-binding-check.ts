/**
 * The one check a document's own metadata bindings are held to, shared by the
 * validator at save and the resolver at render, so what a schema-aware save
 * accepts is what a routed page can use.
 *
 * A text segment is checked as a text prop's binding is. A social image is
 * checked as an image binds: to a media field, or to a URL field, the one text
 * field that says its value is an address. Its fallback is an image address
 * only, not the media library id a block's image may fall back to.
 *
 * @module seo-binding-check
 */
import type { BindingIssue } from "./binding-issues";
import {
  checkBinding,
  type BindingCheck,
  type BindingRefs,
  type BindingSchemaSource,
  type CheckedBinding,
} from "./binding-rules";

/** Where a metadata binding sits: a text value's segment, or the image. */
export type SeoBindingPlace = "text" | "image";

/** What a metadata binding is checked against. */
export interface SeoBindingCheckInput {
  readonly binding: unknown;
  readonly place: SeoBindingPlace;
  /** Names the binding in its issues, as a node id names a block's. */
  readonly id: string;
  readonly schema?: BindingSchemaSource;
  readonly refs?: BindingRefs;
}

/** The prop a metadata binding fills. */
const SEO_PROP = "value";

/**
 * Check one metadata binding. Total, as `checkBinding` is: a binding of any
 * shape gives an outcome, never a throw.
 */
export function checkSeoBinding(input: SeoBindingCheckInput): BindingCheck {
  const check = (type: "text" | "upload" | "url"): BindingCheck =>
    checkBinding({
      nodeId: input.id,
      prop: SEO_PROP,
      binding: input.binding,
      props: { [SEO_PROP]: { type } },
      ...(input.schema === undefined ? {} : { schema: input.schema }),
      ...(input.refs === undefined ? {} : { refs: input.refs }),
      // The social image's fallback is an address only: a page's export
      // and import carry no media from a document's own metadata, so a
      // media id there would be lost on the way. It asks nothing of text.
      imageFallback: "address",
    });
  if (input.place === "text") return check("text");

  // A media field first, then a URL field: the binding fits at most one. A
  // link prop also takes a plain text field, which an image does not.
  const media = check("upload");
  // An image prop also takes a URL field, and reads its fallback as an image
  // would. A URL field is judged as the address it is, so the media reading
  // is kept only for a binding that doesn't end at one.
  if (
    !endsAtUrlField(media) &&
    (media.outcome === "resolve" || !misfits(media.issues))
  ) {
    return media;
  }
  const address = check("url");
  if (address.outcome !== "resolve" || isAddressField(address.binding)) {
    return address;
  }
  const issue: BindingIssue = {
    nodeId: input.id,
    prop: SEO_PROP,
    code: "binding-type-misfit",
    message:
      "A social image binds to a media field or a URL field, so its fallback is shown.",
    path: address.binding.path,
  };
  return {
    outcome: "fallback",
    ...(address.binding.fallback === undefined
      ? {}
      : { fallback: address.binding.fallback }),
    issues: [...address.issues, issue],
  };
}

/** Whether a check found the binding ends at a field declared as a URL. */
function endsAtUrlField(check: BindingCheck): boolean {
  return check.outcome === "resolve" && check.binding.field?.type === "url";
}

/** Whether a check refused a binding because its field's type did not fit. */
function misfits(issues: readonly BindingIssue[]): boolean {
  return issues.some(issue => issue.code === "binding-type-misfit");
}

/** Whether a binding ends at a URL field, or at a field whose type is unknown. */
function isAddressField(binding: CheckedBinding): boolean {
  return binding.field === undefined || binding.field.type === "url";
}
