/**
 * The link from a page's head to its plain-text copy, where copies are
 * switched on: `<link rel="alternate" type="text/markdown" href="…md">`,
 * which the llms.txt proposal names as how a reader finds a page's Markdown.
 *
 * Only a page that is listed (indexed, and its own canonical) has a copy, so
 * only such a page links one; the answer's own canonical and visibility say
 * so, with nothing else read.
 *
 * @module outputs/copy-link
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { codePagesSlug } from "../code-pages/collection";
import { overAnswer, type ReadRules } from "../resolver/provider";

import { copyPathsOf } from "./plain-copy";

/** Any origin, for reading a path that is written from the site's root. */
const ROOT = "https://copy-link.invalid";

/** A path with its trailing slash taken off, so `/a` and `/a/` read alike. */
const bare = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/**
 * Where the answer's page has its copy, as the canonical is written
 * (absolute, or from the site's root); none where the page is kept out of
 * search, names no canonical, or names another page's.
 */
function copyOfAnswer(
  input: PageMetadataInput,
  answer: PageMetadataAnswer
): string | undefined {
  if (answer.canonical === undefined || answer.robots?.index === false) {
    return undefined;
  }
  let canonical: URL;
  try {
    canonical = new URL(answer.canonical, ROOT);
  } catch {
    return undefined;
  }
  if (
    input.path !== undefined &&
    bare(input.path) !== bare(canonical.pathname)
  ) {
    return undefined;
  }
  const [path] = copyPathsOf(canonical.href);
  if (path === undefined) return undefined;
  return canonical.origin === ROOT ? path : new URL(path, canonical).href;
}

/**
 * `resolver` with the link to the page's plain-text copy added to the head
 * of each listed page, where copies are switched on. A page built in code
 * has no copy of its own, so it links none. The switch is read inside the
 * cached answer, which the settings' cache tags already expire.
 */
export function withCopyLink(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  readRules: ReadRules
): PageMetadataResolver {
  return overAnswer(resolver, async (answer, input) => {
    const { source } = input;
    if (source.kind === "entry" && source.collection === codePagesSlug(ctx)) {
      return answer;
    }
    const copy = copyOfAnswer(input, answer);
    if (copy === undefined) return answer;
    const rules = await readRules(ctx, input.locale);
    if (rules.plainTextCopies !== true) return answer;
    return {
      ...answer,
      formats: { ...answer.formats, "text/markdown": copy },
    };
  });
}
