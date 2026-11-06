/**
 * Preview route for block pages: the same documents as `/blocks`, read with
 * access enforced and with a draft gate, so an author's preview link can show
 * the working draft of the one entry its token names.
 *
 * Separate from the public route because the two answer differently shaped
 * questions. The public page is the same for everyone and is pre-rendered; a
 * preview depends on who asks and what their token grants, so it is rendered
 * per request. A draft is never served at the public address.
 *
 * @module app/preview/blocks/[[...slug]]
 */
import { createBlocksPage } from "@nextlyhq/blocks-react/next";
import { previewDraftGate } from "nextly/runtime";

import { blockPagesRoute } from "../../../../lib/block-pages-route";

/**
 * The gate grants exactly the ONE entry the visitor's token names, which is
 * the part Next's own draft mode cannot express: `draftMode()` is a single
 * boolean for the whole host, so enabling it alone would turn a link meant for
 * one unpublished page into a key to every unpublished page on the site.
 */
const { ContentPage, generateMetadata } = createBlocksPage({
  ...blockPagesRoute,
  // Mounted apart from the public route, so a previewed list's links stay
  // in the preview.
  mountPath: "/preview/blocks",
  draft: previewDraftGate(),
});

export { generateMetadata };
export default ContentPage;
