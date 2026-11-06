/**
 * Public route for the CODE-FIRST blocks renderer.
 *
 * The whole route is `createPublicBlocksPage` plus the re-exports Next wants —
 * there is no per-request wiring here, which is the point of the helper.
 *
 * ## What makes this different from the page-builder route
 *
 * Not the document. Both store the engine's `BlockDocument`: `blocks()` declares
 * `storage: "json"` exactly as `json()` does, and there is one `BlockDocument`
 * in the repo. A document authored here renders there and vice versa.
 *
 * The difference is who WRITES it. `block-pages` holds its document in a plain
 * `json` field, so it is authored in code or by an API client and has no editor
 * attached — which is the path a developer takes who wants blocks without the
 * page builder installed. `(frontend)/[...slug]` reads the plugin's `pages`
 * collection, whose `blocks()` field mounts the visual editor.
 *
 * Keeping both is deliberate: converting this collection's field would leave
 * nothing covering the code-authored path.
 *
 * ## Public, and the same for every visitor
 *
 * A published block page reads its content as the public does, so it is the
 * same page whoever asks: it is pre-rendered, refreshed by its cache tags, and
 * never shows a draft. Drafts are previewed at `/preview/blocks/...`, the
 * access-enforced route beside this one, which is where the collection's
 * preview links point.
 *
 * Pre-rendering reads the database during `next build`, which is what the
 * public posture costs.
 *
 * @module app/blocks/[[...slug]]
 */
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";

import { blockPagesRoute } from "../../../lib/block-pages-route";
import { pathsOrRoot } from "../../../lib/static-params";

const route = createPublicBlocksPage(blockPagesRoute);

/** The paths built ahead of time: every published block page, or the root when there is none. */
export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  return pathsOrRoot(route);
}

export const { generateMetadata } = route;
export default route.ContentPage;
