/**
 * Templates & theme parts (spec §I). React-free. The data model reserves
 * `kind: "page" | "template" | "part"`; header/footer parts are stored as their own
 * builder documents. `composeTemplate` wraps a page's content with assigned parts into
 * one render tree — the host `[...slug]` route calls this before `PageRenderer`.
 */
import type { BlockDocument, BlockNode } from "./types";

export interface TemplateParts {
  header?: BlockDocument;
  footer?: BlockDocument;
}

export function composeTemplate(
  page: BlockDocument,
  parts: TemplateParts = {}
): BlockDocument {
  const children: BlockNode[] = [];
  if (parts.header) children.push(parts.header.root);
  children.push(page.root);
  if (parts.footer) children.push(parts.footer.root);

  const root: BlockNode = {
    id: "nx-template-root",
    type: "core/container",
    props: { as: "div" },
    slots: { default: children },
  };
  return { ...page, kind: "page", root };
}
