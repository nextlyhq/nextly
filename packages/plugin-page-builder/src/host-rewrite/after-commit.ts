/**
 * What a write's hook says about the document it wrote, as the walks key it:
 * shared by the reports that send a written document back to a run (the
 * component delete's in-transaction fence, `in-transaction.ts`, and the
 * breakpoint removal's after-commit report).
 *
 * @module host-rewrite/after-commit
 */
import { SINGLE_HOOK_NAMESPACE } from "../write-target";

/** The plugin capabilities an after-commit report needs, named structurally. */
export interface FencedWriteReportContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { error(message: string, meta?: Record<string, unknown>): void };
}

/** Which document a hook's write is to, as the walk keys it. */
export function hookDocumentOf(
  collection: string,
  data: Record<string, unknown>
):
  | { kind: "single"; slug: string }
  | { kind: "collection"; slug: string; id: string }
  | undefined {
  if (collection.startsWith(SINGLE_HOOK_NAMESPACE)) {
    return {
      kind: "single",
      slug: collection.slice(SINGLE_HOOK_NAMESPACE.length),
    };
  }
  const id = data.id;
  if (typeof id === "string" && id !== "") {
    return { kind: "collection", slug: collection, id };
  }
  return typeof id === "number"
    ? { kind: "collection", slug: collection, id: String(id) }
    : undefined;
}
