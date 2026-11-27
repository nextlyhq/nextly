/**
 * A door's tool list as a checked-in snapshot: every name, title,
 * description, hint and schema an agent sees, in a stable order.
 *
 * A test compares the snapshot written in the repository with the list the
 * adapter builds, so a change to an operation that changes a tool fails until
 * the snapshot is updated in the same change, where a reviewer sees it.
 *
 * @module snapshot
 * @experimental
 */
import type { ToolSet } from "./tool-set";

/** The snapshot of `toolSet`'s tools as JSON text, sorted by name, ending in a newline. */
export function toolListSnapshot<Caller>(toolSet: ToolSet<Caller>): string {
  const tools = [...toolSet.tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      oldNames: tool.oldNames,
    }));
  return `${JSON.stringify({ door: toolSet.door, tools }, null, 2)}\n`;
}
