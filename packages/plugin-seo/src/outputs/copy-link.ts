/**
 * The link from a page's head to its plain-text copy, where copies are
 * switched on: `<link rel="alternate" type="text/markdown" href="…md">`,
 * which the llms.txt proposal names as how a reader finds a page's Markdown.
 *
 * Only a page that is listed (indexed, and its own canonical) has a copy, so
 * only such a page links one, and only at an address where its copy is
 * served: the decision serving a copy makes, so the link never leads to
 * another page, such as a page of the site at `/a.md`, or a page at
 * `/index` whose copy `/index.md` is.
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
import { overAnswer } from "../resolver/provider";

import { servedCopyAddress, type AiOutputsConfig } from "./ai-outputs";

/** A path with its trailing slash taken off, so `/a` and `/a/` read alike. */
const bare = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/**
 * The page's own address, whole, where the answer names it as canonical
 * and does not keep it out of search; none otherwise. A canonical written
 * from the site's root is made whole against `origin`.
 */
function listedAddress(
  input: PageMetadataInput,
  answer: PageMetadataAnswer,
  origin: string | undefined
): URL | undefined {
  if (answer.canonical === undefined || answer.robots?.index === false) {
    return undefined;
  }
  let canonical: URL;
  try {
    canonical = new URL(answer.canonical, origin);
  } catch {
    return undefined;
  }
  return input.path !== undefined &&
    bare(input.path) !== bare(canonical.pathname)
    ? undefined
    : canonical;
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
  config: AiOutputsConfig
): PageMetadataResolver {
  return overAnswer(resolver, async (answer, input) => {
    const { source } = input;
    if (source.kind === "entry" && source.collection === codePagesSlug(ctx)) {
      return answer;
    }
    const page = listedAddress(input, answer, config.origin);
    if (page === undefined) return answer;
    const rules = await config.readRules(ctx, input.locale);
    if (rules.plainTextCopies !== true) return answer;
    const copy = await servedCopyAddress(ctx, page.href, config);
    if (copy === undefined) return answer;
    // Written as the canonical is: whole, or from the site's root.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(answer.canonical ?? "")
      ? copy
      : new URL(copy).pathname;
    return {
      ...answer,
      formats: { ...answer.formats, "text/markdown": href },
    };
  });
}
