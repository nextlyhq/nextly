/**
 * The sitemap's files: the listed pages as one sitemaps.org `<urlset>` while
 * they fit in one file, and otherwise split into files that each hold both of
 * the protocol's limits, named by a sitemap index at the sitemap's address.
 *
 * Pure: which pages are listed is decided elsewhere, from each page's answer.
 *
 * @module outputs/sitemap-files
 */
import { escapeXml } from "../sitemap";

/** One listed page, as its sitemap entry says it. */
export interface SitemapPage {
  /** The page's absolute address. */
  loc: string;
  /** When the published page last changed, as ISO-8601. */
  lastModified?: string;
  /** The absolute addresses of the page's main images. */
  images: readonly string[];
}

/** What one file may hold: a number of addresses, and a size in bytes. */
export interface SitemapLimits {
  urls: number;
  bytes: number;
}

/** The protocol's limits: 50,000 addresses and 50 MB uncompressed a file. */
export const SITEMAP_LIMITS: SitemapLimits = {
  urls: 50_000,
  bytes: 50 * 1024 * 1024,
};

const XML_DECLARATION = `<?xml version="1.0" encoding="UTF-8"?>\n`;
const URLSET_OPEN =
  `${XML_DECLARATION}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
  ` xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
const URLSET_CLOSE = `</urlset>`;

// The size a file is held to is its UTF-8 bytes, counted with the web-standard
// encoder so the plugin needs no Node `Buffer`.
const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;
const WRAPPER_BYTES = byteLength(URLSET_OPEN) + byteLength(URLSET_CLOSE);

/** One page's `<url>` line, ending in the newline that follows it. */
function urlLine(page: SitemapPage): string {
  const lastmod =
    page.lastModified === undefined
      ? ""
      : `<lastmod>${escapeXml(page.lastModified)}</lastmod>`;
  const images = page.images
    .map(
      image =>
        `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>`
    )
    .join("");
  return `  <url><loc>${escapeXml(page.loc)}</loc>${lastmod}${images}</url>\n`;
}

/**
 * The pages as sitemap files, in order, each within `limits`: a new file is
 * started before a page would take the one being filled past either limit.
 * A page too large for any file on its own is left out. Always one file at
 * least, empty where nothing is listed.
 */
export function sitemapFiles(
  pages: readonly SitemapPage[],
  limits: SitemapLimits = SITEMAP_LIMITS
): string[] {
  const files: string[][] = [[]];
  let size = WRAPPER_BYTES;
  for (const page of pages) {
    const line = urlLine(page);
    const lineSize = byteLength(line);
    if (WRAPPER_BYTES + lineSize > limits.bytes) continue;
    let current = files[files.length - 1] ?? [];
    if (current.length >= limits.urls || size + lineSize > limits.bytes) {
      current = [];
      files.push(current);
      size = WRAPPER_BYTES;
    }
    current.push(line);
    size += lineSize;
  }
  return files.map(lines => `${URLSET_OPEN}${lines.join("")}${URLSET_CLOSE}`);
}

/** A sitemap index naming each of `locations`. */
function sitemapIndex(locations: readonly string[]): string {
  const entries = locations
    .map(loc => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>\n`)
    .join("");
  return (
    `${XML_DECLARATION}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${entries}</sitemapindex>`
  );
}

/**
 * What the sitemap's address answers: with no `page`, the one file where the
 * pages fit in one, else an index naming each file as `<sitemap>?page=<n>`;
 * with a `page`, that file, or null where there is no such file.
 */
export function sitemapAnswer(
  pages: readonly SitemapPage[],
  options: { sitemap: string; limits?: SitemapLimits; page?: number }
): string | null {
  const files = sitemapFiles(pages, options.limits);
  if (options.page !== undefined) return files[options.page - 1] ?? null;
  if (files.length === 1) return files[0] ?? null;
  return sitemapIndex(
    files.map((_, at) => `${options.sitemap}?page=${at + 1}`)
  );
}
