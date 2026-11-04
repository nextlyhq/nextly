/**
 * The host's say over catalogue fonts: which catalogue the server may reach,
 * and how much one add may download.
 *
 * Parsed when the plugin is defined, so a host that names a host wrongly
 * finds out at boot rather than when an author first adds a font.
 *
 * @module site-fonts/options
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

/** Catalogue fonts, as a host configures them on `pageBuilder()`. */
export interface PageBuilderFontOptions {
  /**
   * Where the Google Fonts catalogue is read and its files downloaded from:
   * Fontsource's api and the jsDelivr file host by default. Each must be a
   * bare `https://` origin. `false` turns the catalogue off; uploading a font
   * file still works.
   */
  catalogue?:
    | false
    | {
        /** Defaults to `https://api.fontsource.org`. */
        api?: string;
        /** Defaults to `https://cdn.jsdelivr.net`. */
        files?: string;
      };
  /** Lower the caps on one add. A value above the default is not raised. */
  limits?: Partial<FontAddLimits>;
}

/** The caps on what one add may download. */
export interface FontAddLimits {
  /** Files one add may download. */
  readonly filesPerAdd: number;
  /** Bytes one file may have. */
  readonly bytesPerFile: number;
  /** Bytes one add may download in all. */
  readonly bytesPerAdd: number;
  /** How long one request to the catalogue may take, in milliseconds. */
  readonly timeoutMs: number;
}

/** The catalogue, its hosts as origins, and the caps an add runs under. */
export interface ResolvedFontOptions {
  readonly api: URL;
  readonly files: URL;
  readonly limits: FontAddLimits;
  /** The hosts as `ctx.fetch` declares them: `host` or `host:port`. */
  readonly outbound: readonly string[];
}

const DEFAULT_LIMITS: FontAddLimits = {
  filesPerAdd: 24,
  bytesPerFile: 2 * 1024 * 1024,
  bytesPerAdd: 10 * 1024 * 1024,
  timeoutMs: 15_000,
};

const DEFAULT_API = "https://api.fontsource.org";
const DEFAULT_FILES = "https://cdn.jsdelivr.net";

const Origin = z.string().refine(isOrigin);

const Options = z
  .strictObject({
    catalogue: z
      .union([
        z.literal(false),
        z.strictObject({ api: Origin.optional(), files: Origin.optional() }),
      ])
      .optional(),
    limits: z
      .strictObject({
        filesPerAdd: z.number().int().positive().optional(),
        bytesPerFile: z.number().int().positive().optional(),
        bytesPerAdd: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .optional();

/**
 * Whether a value is a bare origin the server may be pointed at: `https://`,
 * or plain `http://localhost` for a catalogue a test serves. Nothing after the
 * host, and no name or password in it.
 */
function isOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && url.hostname === "localhost");
  return (
    secure &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !value.endsWith("/?")
  );
}

/** A cap the host may lower and never raise. */
function lowered(given: number | undefined, ceiling: number): number {
  return given === undefined ? ceiling : Math.min(given, ceiling);
}

/**
 * The resolved catalogue, or `false` when the host turned it off.
 *
 * @throws NextlyError `CONFIGURATION_ERROR` when an origin or a cap is not one
 */
export function resolveFontOptions(
  raw: PageBuilderFontOptions | undefined
): ResolvedFontOptions | false {
  const parsed = Options.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.configuration({
      logMessage:
        "pageBuilder({ fonts }) is not usable: each catalogue host must be a bare https:// origin, and each limit a positive whole number.",
      logContext: { issues: parsed.error.issues.map(issue => issue.path) },
    });
  }
  const catalogue = parsed.data?.catalogue;
  if (catalogue === false) return false;
  const api = new URL(catalogue?.api ?? DEFAULT_API);
  const files = new URL(catalogue?.files ?? DEFAULT_FILES);
  const given = parsed.data?.limits ?? {};
  return {
    api,
    files,
    outbound: [...new Set([api.host, files.host])],
    limits: {
      filesPerAdd: lowered(given.filesPerAdd, DEFAULT_LIMITS.filesPerAdd),
      bytesPerFile: lowered(given.bytesPerFile, DEFAULT_LIMITS.bytesPerFile),
      bytesPerAdd: lowered(given.bytesPerAdd, DEFAULT_LIMITS.bytesPerAdd),
      timeoutMs: lowered(given.timeoutMs, DEFAULT_LIMITS.timeoutMs),
    },
  };
}
