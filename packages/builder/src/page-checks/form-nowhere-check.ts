/**
 * A content check: a simple form whose answers have nowhere to go, with no
 * "Send to" address and no form picked from a provider, so what visitors
 * send reaches no one. The canvas says so over the block too, by the same
 * rule (`answersGoNowhere`).
 *
 * @module page-checks/form-nowhere-check
 */
import { walkNodes } from "@nextlyhq/blocks-engine";

import { answersGoNowhere, FORM_BLOCK } from "../form-picked";

import type { PageCheck, PageCheckResult } from "./page-checks";

/** Every Form on the page whose answers have nowhere to go, in page order. */
export const FORM_NOWHERE_CHECK: PageCheck = {
  id: "form-nowhere",
  group: "content",
  run: page => {
    const found: PageCheckResult[] = [];
    walkNodes(page.document.nodes, node => {
      if (node.type !== FORM_BLOCK || !answersGoNowhere(node.props)) return;
      found.push({
        nodeId: node.id,
        what: "Form answers have nowhere to go",
        why: "Visitors can send the form, but their answers aren’t sent or saved anywhere.",
        todo: "Add an address in Send to, or install the Forms plugin to save them.",
        fix: { tab: "content", id: "action" },
      });
    });
    return found;
  },
};
