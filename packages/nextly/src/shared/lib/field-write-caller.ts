/**
 * The caller an entry write is made as, as a plugin field type's validator
 * is told it (`PluginFieldWrite.caller`).
 *
 * Built from the write's own reader: the user, the API key's scope and
 * `overrideAccess` the write is judged by, and the grants it already
 * resolved. Its `can` asks the one decision a plugin route's
 * `ctx.caller.can` and a route's `requiredPermission` ask
 * (`callerMayPerform`), so a validator never judges a caller by rules of
 * its own.
 *
 * @module shared/lib/field-write-caller
 * @experimental
 */
import { callerMayPerform } from "../../auth/access/route-gate-adapters";
import { effectiveCallerScope } from "../../auth/caller-scope";
import { currentPrincipal } from "../../auth/principal-scope";
import type { PluginFieldWriteCaller } from "../../plugins/contributions";

import type { IssueReader } from "./unreadable-field-issues";

/** Which kind of caller the reader is. */
function kindOf(reader: IssueReader): PluginFieldWriteCaller["kind"] {
  // Trusted code is let through by every check, as the write's own access
  // lets it through.
  if (reader.overrideAccess === true) return "system";
  if (effectiveCallerScope(reader.authenticatedScope)?.actorType === "apiKey") {
    return "apiKey";
  }
  if (typeof reader.user?.id === "string" && reader.user.id !== "") {
    return "user";
  }
  return currentPrincipal() === null ? "visitor" : "principal";
}

/** The caller the write `reader` describes is made as. */
export function fieldWriteCaller(reader: IssueReader): PluginFieldWriteCaller {
  const kind = kindOf(reader);
  return {
    kind,
    async can(action: string, resource: string): Promise<boolean> {
      if (kind === "system") return true;
      if (kind !== "user" && kind !== "apiKey") return false;
      const userId = typeof reader.user?.id === "string" ? reader.user.id : "";
      // The roles the write already resolved, so the answer reads no row
      // inside its transaction where it has them.
      const roles = (await reader.grants?.())?.roles;
      return callerMayPerform(
        effectiveCallerScope(reader.authenticatedScope),
        action,
        resource,
        { id: userId, ...(roles === undefined ? {} : { roles }) }
      );
    },
  };
}
