/**
 * Spec redaction options (the plugin's typed excludes).
 *
 * The three arrays are typed separately (not one mixed array) so a path glob
 * cannot be mistaken for a service name or an error code. Service excludes are
 * applied by filtering the operation lists BEFORE generation; path/code excludes
 * are applied after, on the assembled document.
 *
 * @module excludes
 * @since alpha
 */
import type { DocsOperation } from "./descriptors";
import type { OpenApiDocument } from "./generate";

/** The plugin's exclude options. */
export interface ExcludeOptions {
  /** Glob patterns matched against full path entries to drop from the spec. */
  excludePaths?: readonly string[];
  /** Service names whose operations are dropped from the spec. */
  excludeServices?: readonly string[];
  /** Error codes dropped from the generated error component. */
  excludeErrorCodes?: readonly string[];
}

/**
 * Convert a glob (supports `*` for a path segment and `**` across segments) to a
 * RegExp. Kept tiny and dependency-free; excludes are an operator convenience.
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (/[^A-Za-z0-9_/-]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Drop operations whose service is named in `excludeServices`. */
export function excludeOperationsByService(
  operations: readonly DocsOperation[],
  excludeServices: readonly string[] | undefined
): DocsOperation[] {
  if (!excludeServices || excludeServices.length === 0) return [...operations];
  const drop = new Set(excludeServices);
  return operations.filter(op => !drop.has(op.service));
}

/**
 * Drop paths and error codes from an assembled document. The document is
 * freshly generated on every call, so the error-code branch mutates nested
 * schema objects in place via explicit Record casts.
 */
export function applyExcludes(
  doc: OpenApiDocument,
  options: ExcludeOptions
): OpenApiDocument {
  if (options.excludePaths && options.excludePaths.length > 0) {
    const pathRegexes = options.excludePaths.map(globToRegExp);
    const paths = (doc.paths ?? {}) as Record<string, unknown>;
    doc.paths = Object.fromEntries(
      Object.entries(paths).filter(([p]) => !pathRegexes.some(re => re.test(p)))
    );
  }

  if (options.excludeErrorCodes && options.excludeErrorCodes.length > 0) {
    const dropped = new Set(options.excludeErrorCodes);
    const components = (doc.components ?? {}) as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    const errorResponse = schemas.ErrorResponse as Record<string, unknown>;
    const errorResponseProps = errorResponse.properties as Record<
      string,
      unknown
    >;
    const error = errorResponseProps.error as Record<string, unknown>;
    const errorProps = error.properties as Record<string, unknown>;
    const codeProp = errorProps.code as Record<string, unknown>;
    codeProp.enum = ((codeProp.enum as string[]) ?? []).filter(
      c => !dropped.has(c)
    );
  }

  return doc;
}
