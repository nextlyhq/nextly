/**
 * What a form's notification pages read from the admin: the email providers,
 * the Email hub's messages, and whether the signed-in person may open a
 * message in the Email hub. Each read answers an empty or refusing value when
 * it fails, so a page draws with less rather than not at all.
 *
 * @module admin/components/notifications/notification-sources
 */
import { useEffect, useState } from "react";

/** Host-level notification defaults surfaced by the builder-config route. */
export interface NotificationDefaults {
  defaultFrom?: string;
  defaultToEmail?: string;
}

/** An email provider, as the pages name it. */
export interface ProviderOption {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

/** One of the Email hub's messages. */
export interface TemplateOption {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  /** "template" or "layout": layouts wrap messages and cannot be sent. */
  kind?: string;
  /** The message's own sender, provider and reply-to, where it sets them. */
  fromOverride?: string | null;
  providerId?: string | null;
  replyTo?: string | null;
  subject?: string | null;
}

/**
 * Where a message opens in the admin's Email hub. Written out rather than
 * imported because a plugin builds against the SDK, not the admin's routes.
 */
export function emailHubEditHref(templateId: string): string {
  return `/admin/settings/email/messages/edit/${encodeURIComponent(templateId)}`;
}

async function readJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: "include" });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchProviders(): Promise<ProviderOption[]> {
  const json = await readJson<{ providers?: ProviderOption[] }>(
    "/admin/api/email-providers?pageSize=100&page=1"
  );
  return json?.providers ?? [];
}

async function fetchTemplates(): Promise<TemplateOption[]> {
  const json = await readJson<{ templates?: TemplateOption[] }>(
    "/admin/api/email-templates"
  );
  return json?.templates ?? [];
}

/**
 * Whether the signed-in person may open a message in the Email hub's editor.
 * The editor's route needs the grant that saves a message, so a link shown
 * without it would open a page that refuses them. The retired
 * `manage-email-templates` opens nothing on the server, so it shows no link.
 */
async function fetchCanEditTemplates(): Promise<boolean> {
  const json = await readJson<{
    permissions?: string[];
    isSuperAdmin?: boolean;
  }>("/admin/api/me/permissions");
  if (!json) return false;
  return (
    Boolean(json.isSuperAdmin) ||
    (json.permissions ?? []).includes("update-email-templates")
  );
}

/** What the notification pages draw from, read once per page. */
export interface NotificationSources {
  providers: ProviderOption[];
  templates: TemplateOption[];
  canEditTemplates: boolean;
}

/** The providers, messages and Email hub access, as they arrive. */
export function useNotificationSources(): NotificationSources {
  const [sources, setSources] = useState<NotificationSources>({
    providers: [],
    templates: [],
    canEditTemplates: false,
  });
  useEffect(() => {
    let live = true;
    void Promise.all([
      fetchProviders(),
      fetchTemplates(),
      fetchCanEditTemplates(),
    ]).then(([providers, templates, canEditTemplates]) => {
      if (live) setSources({ providers, templates, canEditTemplates });
    });
    return () => {
      live = false;
    };
  }, []);
  return sources;
}
