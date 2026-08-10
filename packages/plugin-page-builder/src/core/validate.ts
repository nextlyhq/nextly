/**
 * Document validation invariants (spec §14). Returns `true` when valid, else a
 * human-readable error string. Used as the `pages.content` field validator (M3) and
 * defensively in the editor. Pure and React-free.
 */
import { declaredSlotsOf } from "./block-structure";
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

    // Structure comes from the React-free source when it has an answer, and from the registry only
    // as a fallback. The registry is populated by a side-effect import of `render/blocks`, which
    // this validator's caller deliberately does not perform — so relying on it alone left the slot
    // check unable to fire at all in the config/server path it actually runs in.
    //
    // Both are read while blocks are migrating: a type whose structure has moved answers from
    // there, one that has not still answers from its definition. This fallback goes away with the
    // last batch, and nothing should be added to it in the meantime.
    // The REGISTRY wins when it has an answer, and structure fills in when it does not. That order
    // matters both ways: a caller passing its own registry is making an explicit statement about
    // its own blocks — including a tighter `allowedBlocks` than any built-in structure carries —
    // and structure must not shadow it. The fallback is what makes the check work at all in the
    // config/server path, where the registry is empty because nothing imported the renderer.
    const structuralSlots = declaredSlotsOf(n.type);
    const declaredSlots = def?.slots ?? structuralSlots;
    const structural = def !== undefined || structuralSlots !== undefined;

    if (n.slots) {
      if (def && !def.isContainer) {
        return `${n.type} cannot have slots (not a container)`;
      }
      for (const [slotName, children] of Object.entries(n.slots)) {
        const spec = declaredSlots?.find(s => s.name === slotName);
        // A slot nothing declares has no allowlist, so every child in it would go unchecked. The
        // absent spec means two different things and only one of them is a reason to reject: a type
        // this build has NO structure for, where the permissive answer is the one `allowUnknown`
        // asked for; and a KNOWN block carrying a slot name it never declared, which nothing asked
        // for. The containment is also retroactively wrong — the day the block declares that name,
        // children never checked against an allowlist become live.
        if (structural && !spec) {
          return `${n.type} has no slot "${slotName}"`;
        }
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
