/**
 * Upload Validation — SVG Sanitization
 *
 * Strict SVG sanitizer built on DOMPurify. The full threat model and
 * tag/attribute rationale live in the design doc; see
 * `docs/configuration/media-upload-security.mdx`.
 *
 * @module services/upload-validation/sanitize-svg
 */

/** 2MB covers virtually all legitimate SVGs while bounding jsdom's work on malicious input. */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

export class SvgTooLargeError extends Error {
  constructor(
    public readonly actualSize: number,
    public readonly maxSize: number
  ) {
    super(`SVG too large: ${actualSize} > ${maxSize} bytes`);
    this.name = "SvgTooLargeError";
  }
}

export class SvgEmptyAfterSanitizeError extends Error {
  constructor() {
    super("SVG was empty after sanitization");
    this.name = "SvgEmptyAfterSanitizeError";
  }
}

/**
 * Strip `<!DOCTYPE …>` before DOMPurify sees the input. jsdom would
 * otherwise expand internal entity declarations (billion-laughs DoS)
 * in its parser pre-pass, before the sanitizer can run.
 */
function stripDoctype(dirty: string): string {
  return dirty.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
}

/**
 * Sanitize an SVG buffer. Throws `SvgTooLargeError` or
 * `SvgEmptyAfterSanitizeError`; callers map these to validation codes.
 *
 * Lazy-imports `isomorphic-dompurify` (pulls jsdom transitively) so
 * non-SVG paths don't pay the cost.
 *
 * @example
 * const clean = await sanitizeSvg(buffer);
 */
export async function sanitizeSvg(buffer: Buffer): Promise<Buffer> {
  if (buffer.length > MAX_SVG_BYTES) {
    throw new SvgTooLargeError(buffer.length, MAX_SVG_BYTES);
  }

  const { default: DOMPurify } = await import("isomorphic-dompurify");

  const dirty = stripDoctype(buffer.toString("utf8"));

  // DOMPurify's hook system is module-global. The addHook → sanitize →
  // removeHook sequence below MUST stay synchronous (no `await` between
  // the calls) so the JS event loop serializes concurrent invocations
  // and hook state can't leak across them.
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    const isHref = data.attrName === "href" || data.attrName === "xlink:href";
    if (isHref && !data.attrValue.startsWith("#")) {
      data.keepAttr = false;
    }
  });
  try {
    const clean = DOMPurify.sanitize(dirty, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // The svg profile drops <use> outright (SSRF safety). Internal
      // sprite-sheet / gradient-reuse references (<use href="#…">) are
      // a common, legitimate pattern; the hook above strips any
      // external href so internal-only <use> is safe.
      ADD_TAGS: ["use"],
      ADD_ATTR: ["href", "xlink:href"],
      FORBID_TAGS: [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "animate",
        "animateMotion",
        "animateTransform",
        "set",
        "audio",
        "video",
        "source",
        "track",
        "image",
        "style",
      ],
      FORBID_ATTR: [
        "onload",
        "onclick",
        "onerror",
        "onmouseover",
        "onfocus",
        "onblur",
        "onchange",
        "onsubmit",
        "onkeydown",
        "onkeyup",
        "onkeypress",
        "onmousedown",
        "onmouseup",
        "onmousemove",
        "onbegin",
        "onend",
        "onrepeat",
        "formaction",
        "xlink:show",
        "xlink:actuate",
      ],
    });

    if (!clean.trim()) {
      throw new SvgEmptyAfterSanitizeError();
    }

    return Buffer.from(clean, "utf8");
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}
