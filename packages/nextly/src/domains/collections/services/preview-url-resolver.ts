/**
 * Where an entry previews: one answer, derived once.
 *
 * A collection may declare a preview two ways, and they are disjoint by
 * construction. A code-first collection declares `url`, a function of the entry
 * that only exists in the server's module graph. A UI-created collection
 * declares `urlTemplate`, a string with `{field}` placeholders, because there is
 * nowhere for it to write a function. Both answer the same question, so both are
 * answered here rather than at each call site.
 *
 * The function is why this runs on the server at all. No column can hold it, so
 * the admin cannot read it back from the registry the way it reads every other
 * `admin` option — it has to ASK. That has a second consequence worth stating
 * plainly, because it is the reason the site URL is read here and not in the
 * browser: resolving in the admin would mean the admin reading site settings,
 * and `settings` is a system resource that the `editor` and `author` presets do
 * not grant. Those are precisely the roles that share preview links. Resolving
 * server-side means the caller needs access to the COLLECTION and never to
 * settings, so the permission a previewer already holds is the only one asked
 * for.
 *
 * @module domains/collections/services/preview-url-resolver
 */

/**
 * A preview declaration, as either authoring path may write it.
 *
 * The two fields are alternatives rather than a pair: `url` comes from
 * `CollectionPreviewConfig` (code-first, where it is required) and `urlTemplate`
 * from the dynamic-collection admin config (UI-created, where no function can be
 * stored). Both are optional here because this type is the union the resolver
 * sees, not either authoring surface.
 */
export interface PreviewDeclaration {
  /** Code-first: computes the URL from the entry, or declines by returning null. */
  url?: (entry: Record<string, unknown>) => string | null;
  /** UI-created: a path with `{fieldName}` placeholders. */
  urlTemplate?: string;
}

/**
 * What a preview resolution can say, including that it cannot answer.
 *
 * Four cases and not two, deliberately. Three of them render as "no preview
 * button", so collapsing them into `null` is the tempting simplification — and
 * it is the one that caused the defect this shape exists to prevent. A resolver
 * that answers `null` for "the site URL is not configured" is indistinguishable
 * from one answering `null` for "this collection has no preview", so a caller
 * that wants to recover has nothing to branch on and reaches for the only origin
 * it can see: its own. That is the admin's host, which is confidently wrong.
 *
 * `notConfigured` and `unavailable` are also worth separating even though both
 * hide the button, because only one of them is a state the editor can leave: an
 * entry with no slug yet becomes previewable once it has one, while a collection
 * with no preview declaration never does.
 */
export type PreviewUrlResolution =
  /** A complete, absolute URL. */
  | { status: "resolved"; url: string }
  /** This collection declares no preview at all. */
  | { status: "notConfigured" }
  /**
   * A preview is declared, but not for this entry right now — the authored
   * function returned null, or a template placeholder has no value yet.
   */
  | { status: "unavailable" }
  /**
   * A path was produced and nothing can name a host for it. Distinct from every
   * case above because a guess IS available here and is wrong.
   *
   * Covers a site URL that is absent AND one that is unusable — a scheme the
   * browser would execute rather than navigate to, which is refused rather than
   * returned. Both share one remedy: an administrator sets a real site URL. They
   * are merged for that reason and not because they are the same event.
   */
  | { status: "noSiteUrl"; path: string };

/**
 * True when a collection declares a preview by either route.
 *
 * Exported because the admin needs the button's PRESENCE without a round trip,
 * and a boolean is something the registry can store even though the function it
 * is derived from is not. Both readers ask this one predicate: the projection
 * that persists `hasPreview` and the resolver below. Deriving the stored boolean
 * from the same expression that decides the resolution is what keeps a persisted
 * `hasPreview: true` from outliving the declaration it was computed from.
 */
export function hasPreviewConfigured(
  preview: PreviewDeclaration | undefined
): boolean {
  if (!preview) return false;
  return typeof preview.url === "function" || Boolean(preview.urlTemplate);
}

/**
 * The text a field value contributes to a URL, or null if it cannot contribute.
 *
 * An allowlist of the types that have a meaningful string form, rather than a
 * denylist of the ones that do not. The two are not equivalent: excluding
 * objects leaves functions through, and `String(fn)` is the function's SOURCE
 * TEXT — a long, valid-looking path segment. Naming what is permitted cannot
 * develop that kind of gap as the set of possible field values grows.
 *
 * Empty string is rejected alongside null and undefined because all three mean
 * the same thing to an editor: the field has not been filled in, so no URL can
 * be built from it yet.
 */
function asUrlSegment(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

/**
 * The schemes a resolved preview URL may carry.
 *
 * The result of this module is assigned to `location.href` by the admin, so what
 * comes back is not a string — it is something the browser will EXECUTE if the
 * scheme says so. `javascript:` and `data:` both run script in the assigning
 * document's origin, which for the preview tab is the admin's own.
 *
 * An allowlist rather than a check for the two known-bad schemes: `vbscript:`,
 * `blob:` and whatever a future engine adds would each need their own entry, and
 * the gap would be silent. Naming what may navigate cannot develop that gap.
 */
const NAVIGABLE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Parse `value` as an absolute URL that is safe to navigate to, or null.
 *
 * One predicate for both places an absolute URL enters this module — the site
 * URL read from settings, and a declaration that returned a full URL itself — so
 * the two cannot end up holding different opinions about what is navigable.
 *
 * The site URL is the reason this exists. It is stored through an API whose
 * schema is `z.string().url()`, and that accepts any scheme the WHATWG parser
 * does: `javascript:alert(1)` validates. Without this, such a value would be
 * concatenated with a path, returned as `resolved`, and assigned to a
 * same-origin blank tab — turning a settings write into script execution in the
 * admin for whoever next clicks Preview.
 */
function asNavigableUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return NAVIGABLE_PROTOCOLS.has(parsed.protocol) ? parsed : null;
}

/**
 * Substitute `{fieldName}` placeholders with entry values.
 *
 * Returns null when any placeholder has no usable value, which is the
 * `unavailable` case: a template naming `{slug}` cannot produce a URL for an
 * entry whose slug has not been filled in yet. Values are compared against
 * null/undefined/empty-string rather than tested for truthiness, so a legitimate
 * `0` or `false` interpolates instead of suppressing the whole URL.
 */
function interpolate(
  template: string,
  entry: Record<string, unknown>
): string | null {
  const placeholders = template.match(/\{(\w+)\}/g);
  if (!placeholders) return template;

  let result = template;
  for (const placeholder of placeholders) {
    const field = placeholder.slice(1, -1);
    const text = asUrlSegment(entry[field]);
    if (text === null) return null;
    result = result.replace(placeholder, encodeURIComponent(text));
  }
  return result;
}

/**
 * A code-first `preview.url` function built from a `{field}` template.
 *
 * The two authoring paths are disjoint by construction — a code-first
 * collection declares a function, a UI-created one declares a template string —
 * so a package that ships a collection in code and wants to express its preview
 * as a PATH has no way to say so. This bridges them, and it is built on the
 * same `interpolate` the template path uses rather than beside it: two
 * substitution rules that agree today would drift, and the drift is silent
 * because a wrong preview URL still looks like a URL.
 *
 * Returns `null` for an entry whose placeholders are not all filled, which the
 * resolver reports as `unavailable` — an entry with no slug yet is not
 * previewable, and will be once it has one.
 */
export function previewUrlFromTemplate(
  template: string
): (entry: Record<string, unknown>) => string | null {
  return entry => interpolate(template, entry);
}

/**
 * Resolve the preview URL for one entry.
 *
 * `siteUrl` is where the reader's site is served, which is what turns the
 * authored path into something that survives being pasted into an email. A
 * declaration that already returns an absolute URL is passed through untouched —
 * an author who writes a full URL has named the host deliberately, and
 * re-basing it against the configured site would override that.
 */
export function resolvePreviewUrl({
  preview,
  entry,
  siteUrl,
}: {
  preview: PreviewDeclaration | undefined;
  entry: Record<string, unknown>;
  siteUrl: string | null;
}): PreviewUrlResolution {
  if (!hasPreviewConfigured(preview)) return { status: "notConfigured" };

  let path: string | null = null;

  if (typeof preview?.url === "function") {
    // The authored function is user code running inside a request. It may throw,
    // and a throw here is the collection declining to preview rather than a
    // server fault, so it is reported as `unavailable` — the same answer as a
    // deliberate `return null` — instead of failing the request.
    try {
      path = preview.url(entry);
    } catch {
      return { status: "unavailable" };
    }
  } else if (preview?.urlTemplate) {
    path = interpolate(preview.urlTemplate, entry);
  }

  if (path === null || path === "") return { status: "unavailable" };

  // An author who returned a full URL named the host deliberately, so it is not
  // re-based against the configured site. It still has to be navigable: the
  // declaration is user code and may compute anything.
  const absolute = asNavigableUrl(path);
  if (absolute) return { status: "resolved", url: path };

  // A relative path cannot carry a scheme, so it needs no such check — a value
  // like `javascript:...` fails to parse as absolute above and lands here, where
  // joining it under the site's origin makes it an ordinary path segment.
  const base = siteUrl === null ? null : asNavigableUrl(siteUrl);
  if (!base) return { status: "noSiteUrl", path };

  // Join without doubling or dropping the separator: the configured site may or
  // may not carry a trailing slash, and an authored path may or may not lead
  // with one.
  const basePath = `${base.origin}${base.pathname}`.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  const joined = joinUnderSite(`${basePath}${suffix}`, base);
  // The pieces parsed separately and not together, which is a declaration this
  // resolver cannot turn into an address.
  if (joined === null) return { status: "unavailable" };
  return { status: "resolved", url: joined };
}

/**
 * An authored path placed under the configured site, keeping what the site URL
 * itself declared.
 *
 * The site's own query and fragment are CARRIED rather than discarded. A site
 * URL may legitimately hold one — a tenant selector is the usual reason — and
 * the settings schema accepts it, so dropping it would send a visitor to the
 * same path on a different tenant. It would also disagree with the minted link,
 * which keeps it: the reviewer's first request would arrive scoped correctly and
 * the redirect would then strip the scope.
 *
 * The authored path wins a conflict. It describes one document while the site
 * URL describes the deployment, so the narrower statement is the one to honour.
 */
function joinUnderSite(candidate: string, base: URL): string | null {
  try {
    const joined = new URL(candidate);
    for (const [key, value] of base.searchParams) {
      if (!joined.searchParams.has(key)) joined.searchParams.append(key, value);
    }
    if (joined.hash === "" && base.hash !== "") joined.hash = base.hash;
    return joined.toString();
  } catch {
    return null;
  }
}
