/**
 * Parse human-readable byte sizes used in `security.limits` config.
 *
 * Audit H13 (T-012). Accepts either a number (interpreted as bytes)
 * or a string with an optional suffix: `b`, `kb`, `mb`, `gb`, `tb`
 * (case-insensitive). `1024` units, not SI — matches the convention
 * common in Node config (Express body-parser, koa-body, etc.).
 *
 * Throws on garbage input — config errors should fail loudly at
 * sanitisation time, not silently fall back to a default.
 */

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
};

export function parseByteSize(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(
        `[nextly/security/limits] expected positive integer byte count; got ${value}`
      );
    }
    return value;
  }
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) {
    throw new Error(
      `[nextly/security/limits] cannot parse byte size: "${value}". Use a number or "1mb" / "500kb" etc.`
    );
  }
  const n = Number(match[1]);
  const unit = match[2] ?? "b";
  return Math.floor(n * UNITS[unit]);
}

/**
 * Resolved (defaults-applied) version of `security.limits`. Numbers
 * are byte counts; *Count fields are integers.
 */
export interface ResolvedSecurityLimits {
  json: number;
  multipart: number;
  fileSize: number;
  fileCount: number;
  fieldCount: number;
  fieldSize: number;
}

export const DEFAULT_SECURITY_LIMITS: ResolvedSecurityLimits = {
  json: parseByteSize("1mb"),
  multipart: parseByteSize("50mb"),
  fileSize: parseByteSize("10mb"),
  fileCount: 10,
  fieldCount: 50,
  fieldSize: parseByteSize("100kb"),
};

export interface RawSecurityLimits {
  json?: number | string;
  multipart?: number | string;
  fileSize?: number | string;
  fileCount?: number;
  fieldCount?: number;
  fieldSize?: number | string;
}

export function resolveSecurityLimits(
  raw: RawSecurityLimits | undefined
): ResolvedSecurityLimits {
  if (!raw) return DEFAULT_SECURITY_LIMITS;
  return {
    json: raw.json !== undefined ? parseByteSize(raw.json) : DEFAULT_SECURITY_LIMITS.json,
    multipart:
      raw.multipart !== undefined
        ? parseByteSize(raw.multipart)
        : DEFAULT_SECURITY_LIMITS.multipart,
    fileSize:
      raw.fileSize !== undefined
        ? parseByteSize(raw.fileSize)
        : DEFAULT_SECURITY_LIMITS.fileSize,
    fileCount: raw.fileCount ?? DEFAULT_SECURITY_LIMITS.fileCount,
    fieldCount: raw.fieldCount ?? DEFAULT_SECURITY_LIMITS.fieldCount,
    fieldSize:
      raw.fieldSize !== undefined
        ? parseByteSize(raw.fieldSize)
        : DEFAULT_SECURITY_LIMITS.fieldSize,
  };
}

/**
 * Cheap pre-parse guard: inspect Content-Length and reject early.
 * Returns null if the request is acceptable, or a 413 Response.
 *
 * Cannot defend against a chunked-encoding upload that lies about
 * its length — that requires a streaming parser. For multipart
 * uploads, the per-file size cap (enforced after parse) covers the
 * residual risk for the common file-upload case.
 */
export function checkRequestSize(
  request: Request,
  limit: number
): Response | null {
  const lengthHeader = request.headers.get("content-length");
  if (!lengthHeader) return null;
  const length = Number(lengthHeader);
  if (!Number.isFinite(length) || length < 0) return null;
  if (length > limit) {
    return new Response(
      JSON.stringify({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: `Request body exceeds the configured limit of ${limit} bytes.`,
        },
      }),
      {
        status: 413,
        headers: { "content-type": "application/json" },
      }
    );
  }
  return null;
}
