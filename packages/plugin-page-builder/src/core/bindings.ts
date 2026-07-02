/**
 * Typed data-binding resolution for the Query Loop (spec §10). React-free.
 *
 * Bindings live in `node.bindings` (kept separate from literal props). At render time
 * each binding is resolved from the current loop item via a dot-path, optionally
 * transformed, and merged over the node's literal props.
 */
import type { BlockNode } from "./types";

/** Safe dotted read: getPath({a:{b:2}}, "a.b") === 2. */
export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Minimal, extensible transform registry. Unknown transforms pass the value through. */
function applyTransform(value: unknown, transform?: string): unknown {
  if (!transform) return value;
  const idx = transform.indexOf(":");
  const name = (idx === -1 ? transform : transform.slice(0, idx)).trim();
  switch (name) {
    case "uppercase":
      return typeof value === "string" ? value.toUpperCase() : value;
    case "lowercase":
      return typeof value === "string" ? value.toLowerCase() : value;
    case "date": {
      if (typeof value !== "string" && typeof value !== "number") return value;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
    }
    default:
      return value;
  }
}

/**
 * Return a props object with each `node.bindings[prop]` resolved from `item`
 * (dot-path + optional transform) merged over `node.props`. Literal props untouched.
 */
export function resolveBindings(
  node: BlockNode,
  item: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node.props };
  if (node.bindings) {
    for (const [prop, binding] of Object.entries(node.bindings)) {
      out[prop] = applyTransform(
        getPath(item, binding.path),
        binding.transform
      );
    }
  }
  return out;
}
