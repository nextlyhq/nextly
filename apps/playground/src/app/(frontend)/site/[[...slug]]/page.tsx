/**
 * The page builder's pages as a public site serves them: cached, rebuilt by
 * their tags, and the same for every visitor.
 *
 * The same pages and Layouts as the root route (`../[...slug]`), under the
 * other posture. That route reads as the visitor and takes a preview link, so
 * nothing it draws can be cached as a page. This one reads published content
 * only, so a page is rendered once, kept, and rebuilt when something it read
 * is published: its own entry, a component it places, its Layout or that
 * Layout's regions. That is the posture of a marketing site, and the one in
 * which "a publish updates every page that uses it, and no other page" can be
 * seen at all.
 *
 * Pre-rendering reads the database during `next build`, which is what the
 * public posture costs.
 *
 * @module app/(frontend)/site/[[...slug]]
 */
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";

import { pagesRoute } from "../../../../lib/pages-route";
import { pathsOrRoot } from "../../../../lib/static-params";

const route = createPublicBlocksPage(pagesRoute);

/** The paths built ahead of time: every published page, or the root when there is none. */
export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  return pathsOrRoot(route);
}

export const { generateMetadata } = route;
export default route.ContentPage;
