"use client";

/**
 * What the form editor reads from the plugin's resolved options: which field
 * types the picker offers, the notification and spam defaults, the redirect
 * targets, and the collections' resolved slugs.
 *
 * @module admin/use-builder-config
 */
import type { FormFieldCatalogType } from "nextly/field-catalog";
import { FORM_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { useEffect, useState } from "react";

import type { NotificationDefaults } from "./components/builder/FormNotificationsTab";
import type { SpamDefaults } from "./components/builder/FormSettingsTab";

/** The configuration as the route answers it. */
interface BuilderConfigResponse {
  fields?: Record<string, boolean>;
  notifications?: NotificationDefaults;
  spamProtection?: SpamDefaults;
  redirectCollections?: string[];
  slugs?: { forms?: string; submissions?: string };
}

/**
 * The configuration as the editor uses it. Each value is `null` until the
 * request settles, so a consumer can tell "not known yet" from "none".
 */
export interface BuilderConfig {
  /**
   * The field types the picker offers. If the request fails every type is
   * offered: the exclude list is an authoring preference (the server accepts
   * any type in a form's JSON), so hiding every type on a passing failure
   * would cost more than a picker briefly unfiltered.
   */
  enabledTypes: FormFieldCatalogType[] | null;
  /**
   * Type ids the host turned off (`fields[type] === false`), plugin types
   * included, so the host's exclusions apply to contributed types too.
   */
  disabledFieldTypes: ReadonlySet<string>;
  /** The host's notification defaults; `{}` when none or the request failed. */
  notificationDefaults: NotificationDefaults | null;
  /** The plugin's spam defaults, what "inherit" resolves to. */
  spamDefaults: SpamDefaults | null;
  /** Collections a form may redirect to. */
  redirectCollections: string[] | null;
  /**
   * Whether the request FAILED, kept apart from what it returned: a refusal
   * mapped to an empty list would read as "this site configures no redirect
   * targets", stated as fact with no way to tell or retry.
   */
  failed: boolean;
  /** The submissions collection's resolved slug, once known. */
  submissionsSlug: string | undefined;
}

const LOADING: BuilderConfig = {
  enabledTypes: null,
  disabledFieldTypes: new Set(),
  notificationDefaults: null,
  spamDefaults: null,
  redirectCollections: null,
  failed: false,
  submissionsSlug: undefined,
};

/** The editor's configuration from the route's answer, `null` for a failure. */
function builderConfigFrom(
  config: BuilderConfigResponse | null
): BuilderConfig {
  const allTypes = FORM_FIELD_TYPE_CATALOG.map(entry => entry.type);
  const fields = config?.fields;
  return {
    enabledTypes: fields
      ? allTypes.filter(type => fields[type] !== false)
      : allTypes,
    disabledFieldTypes: new Set(
      Object.entries(fields ?? {})
        .filter(([, enabled]) => enabled === false)
        .map(([type]) => type)
    ),
    notificationDefaults: config?.notifications ?? {},
    spamDefaults: config?.spamProtection ?? {},
    redirectCollections: config?.redirectCollections ?? [],
    failed: config === null,
    submissionsSlug: config?.slugs?.submissions,
  };
}

/** Reads the configuration once, as the editor mounts. */
export function useBuilderConfig(): BuilderConfig {
  const [config, setConfig] = useState<BuilderConfig>(LOADING);
  useEffect(() => {
    let cancelled = false;
    void fetch(
      "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config",
      { credentials: "include" }
    )
      .then(response => (response.ok ? response.json() : null))
      .then((body: BuilderConfigResponse | null) => {
        if (!cancelled) setConfig(builderConfigFrom(body));
      })
      .catch(() => {
        if (!cancelled) setConfig(builderConfigFrom(null));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
