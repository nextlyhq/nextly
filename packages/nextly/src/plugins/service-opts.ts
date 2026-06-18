import { NextlyError } from "../errors/nextly-error";
import type { RequestContext } from "../services/shared";
import type { AuthUser } from "../types/auth";

/**
 * @experimental Elevation options for the managed `ctx.services` path (D35).
 * Default: `system` when no `user` is supplied (no-user → system). Validation/
 * hooks/events ALWAYS run, even under `system` — only the access check is bypassed.
 *
 * Under `as:'user'`, RBAC is enforced by `user.id` (DB lookup). Code-defined
 * `access` rules that read `ctx.user.role` see it empty — pass `system`, or rely on
 * DB RBAC, for now (documented v1 limitation).
 */
export interface ServiceOpts {
  as?: "user" | "system";
  user?: AuthUser;
}

/** Translate {@link ServiceOpts} into the facade's `{ user, overrideAccess }` (D35). */
export function resolveServiceOpts(opts: ServiceOpts): {
  user?: RequestContext["user"];
  overrideAccess: boolean;
} {
  const { as, user } = opts;
  const wantsUser = as === "user" || (as === undefined && user !== undefined);
  if (wantsUser) {
    if (!user) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        statusCode: 400,
        publicMessage: "Permission configuration is invalid.",
        logMessage: "ServiceOpts as:'user' requires a `user`",
        logContext: { reason: "service-opts-user-missing" },
      });
    }
    return {
      overrideAccess: false,
      user: { id: user.id, email: user.email, role: "", permissions: [] },
    };
  }
  return { overrideAccess: true };
}
