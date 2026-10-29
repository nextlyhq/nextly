/**
 * Telling a plugin, once, that it asks for a retired `manage-` permission.
 *
 * `manage-<resource>` on media, settings, email providers and email templates
 * is retired: a gate asking it is answered by the plain read, create, update
 * and delete there together (`decidePermission`). A plugin written before
 * then still works, and is told which permission to ask instead, once per
 * plugin and resource for the life of the process.
 *
 * @module plugins/routes/retired-manage-asked
 */
import { isRetiredManage } from "../../auth/access/manage-bridge";
import { getNextlyLogger } from "../../observability/logger";

/** The plugins already told, with the resource they asked about. */
const told = new Set<string>();

/** Logs that `plugin` asks a retired `manage-` permission, once. */
export function noteRetiredManageAsked(
  plugin: string,
  action: string,
  resource: string
): void {
  if (!isRetiredManage(action, resource)) return;
  const asked = `${plugin}\u0000${resource}`;
  if (told.has(asked)) return;
  told.add(asked);
  getNextlyLogger().warn({
    kind: "retired-manage-asked",
    plugin,
    asked: `manage-${resource}`,
    message: `The plugin asks for "manage-${resource}", which is retired. It is answered by read, create, update and delete on ${resource} together; ask for the one the plugin needs, such as "update-${resource}".`,
  });
}
