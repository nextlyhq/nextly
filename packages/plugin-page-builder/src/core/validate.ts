/**
 * Document validation invariants (spec §14). Returns `true` when valid, else a
 * human-readable error string. Used as the `pages.content` field validator (M3) and
 * defensively in the editor. Pure and React-free.
 */
import type { BlockRegistry } from "./registry";
import type { BlockDocument, BlockNode } from "./types";
import { MAX_DEPTH, MAX_NODES } from "./types";

export interface ValidateOptions {
  /** Preserve/accept unknown block types (resilience, spec §12). Default false. */
  allowUnknown?: boolean;
}

export function validateDocument(
  doc: unknown,
  registry: BlockRegistry,
  opts: ValidateOptions = {}
): true | string {
  if (!doc || typeof doc !== "object") return "document must be an object";
  const d = doc as BlockDocument;
  if (d.version !== 1) {
    return `unsupported document version ${String((d as { version?: unknown }).version)}`;
  }
  if (!d.root || typeof d.root !== "object") return "document.root is required";

  const seen = new Set<string>();
  let count = 0;

  const check = (n: BlockNode, depth: number): string | null => {
    if (depth > MAX_DEPTH) return `tree exceeds max depth ${MAX_DEPTH}`;
    if (++count > MAX_NODES) return `tree exceeds max node count ${MAX_NODES}`;
    if (!n || typeof n.id !== "string" || !n.id) return "node is missing an id";
    if (seen.has(n.id)) return `duplicate node id ${n.id}`;
    seen.add(n.id);
    if (typeof n.type !== "string" || !n.type.includes("/")) {
      return `node type must be namespaced: ${String(n.type)}`;
    }

    const def = registry.get(n.type);
    if (!def && !opts.allowUnknown) return `unknown block type ${n.type}`;

    if (n.slots) {
      if (def && !def.isContainer) {
        return `${n.type} cannot have slots (not a container)`;
      }
      for (const [slotName, children] of Object.entries(n.slots)) {
        const spec = def?.slots?.find(s => s.name === slotName);
        for (const child of children) {
          if (spec?.allowedBlocks && !spec.allowedBlocks.includes(child.type)) {
            return `${child.type} is not allowed in slot "${slotName}" of ${n.type}`;
          }
          const e = check(child, depth + 1);
          if (e) return e;
        }
      }
    }

    if (def?.validate) {
      const r = def.validate(n);
      if (r !== true) return r;
    }
    return null;
  };

  return check(d.root, 0) ?? true;
}
