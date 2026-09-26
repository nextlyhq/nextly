/**
 * Building one plugin's `ctx.audit`.
 *
 * @module plugins/plugin-audit-provider
 * @since 1.0.0
 */
import { getService } from "../di/register";
import { buildAuditLogWriter } from "../domains/audit/audit-log-writer";
import {
  collectPluginAuditKinds,
  projectPluginAuditEvent,
} from "../domains/audit/plugin-audit";
import { getNextlyLogger } from "../observability/logger";
import { getTrustedClientIp } from "../utils/get-trusted-client-ip";
import { readProxyTrustSettings } from "../utils/proxy-trust";

import type { PluginAuditApi, PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";

/**
 * The audit API for one plugin.
 *
 * The declared kinds are collected once, at construction: they come from the
 * manifest and cannot change while the process runs, and rebuilding the map on
 * every write would be work repeated for no reason.
 */
export function createPluginAudit(plugin: PluginDefinition): PluginAuditApi {
  const slug = pluginAdminSlug(plugin.name);
  // The same call resolution already made, so the two cannot disagree about
  // which kinds are declared. By the time a context is built this cannot
  // throw: `resolvePlugins` made it first and refused the boot.
  const kinds = collectPluginAuditKinds(
    slug,
    plugin.contributes?.audit?.kinds ?? [],
    plugin.name
  );

  return {
    async write(event) {
      const projected = projectPluginAuditEvent(event, kinds, plugin.name);
      if (!projected) return;

      try {
        const writer = buildAuditLogWriter(
          getService as (n: string) => unknown
        );
        // `PluginAuditApi.write` accepts a request and the projection keeps
        // it deliberately, and it stopped here — so a plugin's authentication
        // and security rows lost the caller context the equivalent core rows
        // retain, even when the plugin took the trouble to supply it.
        //
        // Resolved through the same helper core uses, under the same proxy
        // settings: a client IP read straight from a header is whatever the
        // caller wrote there.
        const { request } = projected;
        const trust = request
          ? readProxyTrustSettings(() => getService("config"))
          : undefined;

        await writer.write({
          kind: projected.kind as never,
          actorUserId: projected.actorUserId ?? undefined,
          targetUserId: projected.targetUserId ?? undefined,
          metadata: projected.metadata,
          ...(request && trust
            ? {
                ipAddress: getTrustedClientIp(request, trust),
                userAgent: request.headers.get("user-agent"),
              }
            : {}),
        });
      } catch (error) {
        // Same contract as the core writer: never throw. The caller is in the
        // middle of doing the thing the row describes.
        getNextlyLogger().warn({
          kind: "plugin-audit-write-failed",
          plugin: plugin.name,
          auditKind: event.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
