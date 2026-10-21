/**
 * Who owns each email template, and what each owner's current version is.
 *
 * Core owns its built-in templates and the default layout; a running plugin
 * owns what it contributes; the site owns everything else. At boot the email
 * domain builds one registry of every owned template's current default and
 * reconciles the stored rows against it: an owner's template that the site has
 * not overridden follows the owner, and one the site has overridden keeps the
 * site's version along with a copy of the owner's version it started from.
 *
 * Ownership is decided here, on the server, from what core and the running
 * plugins declare. The admin only displays it.
 */

import { createHash } from "crypto";

import type { PluginEmailTemplate } from "../../plugins/contributions";
import type {
  EmailTemplateInsert,
  EmailTemplateOwner,
  EmailTemplateVariable,
  EmailTemplateVersion,
} from "../../schemas/email-templates/types";

import type { EmailConfig } from "./types";

/** An owner as the registry records it: a plugin there is always running. */
export type RegisteredOwner =
  | { kind: "core" }
  | { kind: "plugin"; name: string };

/**
 * A template as its owner declares it: the row it ships, and whether it
 * carries a secret, which only an owner can say and no edit can change.
 */
export type OwnerTemplate = EmailTemplateInsert & { carriesSecret?: boolean };

/** One owned template's current default. */
export interface OwnedTemplate {
  slug: string;
  owner: RegisteredOwner;
  /** The full default the owner ships, as it would be inserted. */
  defaults: EmailTemplateInsert;
  /** The versioned part of `defaults`. */
  version: EmailTemplateVersion;
  /** `versionDigest(version)`, computed once. */
  digest: string;
  /** Whether the owner marks it as carrying a secret. */
  carriesSecret: boolean;
}

export interface TemplateOwnerRegistry {
  /** Every owned template, by slug. */
  owned: ReadonlyMap<string, OwnedTemplate>;
  /** Slugs the site's code sets through `email.templates` in `defineConfig()`. */
  setInCode: ReadonlySet<string>;
  /**
   * Whether the running plugins and the site's code were known when this was
   * built. Until they are, only core's templates are registered, and a
   * plugin's template cannot be told from one of a plugin that is gone.
   */
  complete: boolean;
}

/**
 * The core slugs `email.templates` in `defineConfig()` can set, and the config
 * key for each. One table, read by the send path to find a site's code version
 * and by the registry to know which templates are set in code.
 */
export const CODE_TEMPLATE_KEYS: Readonly<
  Record<string, keyof NonNullable<EmailConfig["templates"]>>
> = {
  welcome: "welcome",
  "password-reset": "passwordReset",
  "email-verification": "emailVerification",
};

/**
 * The slugs first-party plugins contribute, so a template left behind by one
 * of them can be recognised while the plugin is not running. Exact slugs, not
 * a prefix: a site's own `accounts-newsletter` stays the site's. A plugin
 * that is running declares its own templates, so this is needed only for one
 * that is absent; a third-party plugin's leftover templates count as the
 * site's until that plugin runs again and claims them.
 */
export const KNOWN_PLUGIN_TEMPLATES: ReadonlyArray<{
  plugin: string;
  slugs: ReadonlyArray<string>;
}> = [
  {
    plugin: "@nextlyhq/plugin-accounts",
    slugs: [
      "verify-address",
      "sign-up-taken",
      "reset-password",
      "reset-required",
      "address-change-asked",
      "confirm-new-address",
      "address-in-use",
      "address-changed",
      "account-deleted",
      "password-changed",
    ].map(kind => `accounts-${kind}`),
  },
];

/** The plugin a leftover template belongs to, by its slug, or null. */
export function absentPluginFor(slug: string): string | null {
  const match = KNOWN_PLUGIN_TEMPLATES.find(entry =>
    entry.slugs.includes(slug)
  );
  return match ? match.plugin : null;
}

/** The versioned part of a template. */
export function versionOf(template: {
  subject: string;
  htmlContent: string;
  plainTextContent?: string | null;
  preheader?: string | null;
}): EmailTemplateVersion {
  return {
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? null,
    preheader: template.preheader ?? null,
  };
}

const LINE_ENDINGS = /\r\n?/g;

/**
 * Remove trailing whitespace from each line of HTML, except inside `<pre>`,
 * where it is part of what the reader sees.
 */
function trimHtmlLineEnds(html: string): string {
  let depth = 0;
  return html
    .split("\n")
    .map(line => {
      const startsInside = depth > 0;
      depth = Math.max(
        0,
        depth +
          (line.match(/<pre\b/gi) ?? []).length -
          (line.match(/<\/pre>/gi) ?? []).length
      );
      // A line that starts or ends inside a <pre> keeps its whitespace.
      return startsInside || depth > 0 ? line : line.replace(/[ \t]+$/, "");
    })
    .join("\n");
}

/**
 * A version as compared: line endings unified everywhere, and trailing
 * whitespace dropped only where it cannot change what is delivered, which is
 * outside `<pre>` in the HTML and never in the plain-text body. An empty
 * optional field and a missing one are the same.
 */
export function normalizeVersion(
  version: EmailTemplateVersion
): EmailTemplateVersion {
  const text = (value: string | null): string | null => {
    const unified = value?.replace(LINE_ENDINGS, "\n") ?? "";
    return unified === "" ? null : unified;
  };
  return {
    subject: version.subject.replace(LINE_ENDINGS, "\n").trimEnd(),
    htmlContent: trimHtmlLineEnds(
      version.htmlContent.replace(LINE_ENDINGS, "\n")
    ),
    plainTextContent: text(version.plainTextContent),
    preheader: text(version.preheader)?.trimEnd() || null,
  };
}

/** A stable digest of a version, as compared. */
export function versionDigest(version: EmailTemplateVersion): string {
  const v = normalizeVersion(version);
  return createHash("sha256")
    .update(
      JSON.stringify([
        v.subject,
        v.htmlContent,
        v.plainTextContent,
        v.preheader,
      ])
    )
    .digest("hex");
}

/** Whether two versions would deliver the same email. */
export function sameVersion(
  a: EmailTemplateVersion,
  b: EmailTemplateVersion
): boolean {
  return versionDigest(a) === versionDigest(b);
}

function owned(owner: RegisteredOwner, declared: OwnerTemplate): OwnedTemplate {
  const { carriesSecret, ...defaults } = declared;
  const version = versionOf(defaults);
  return {
    slug: defaults.slug,
    owner,
    defaults,
    version,
    digest: versionDigest(version),
    // Strictly true: a plugin is plain JavaScript at runtime, and only an
    // explicit mark should count as one.
    carriesSecret: carriesSecret === true,
  };
}

/** A plugin's contribution, in the shape core inserts. */
function pluginDefaults(template: PluginEmailTemplate): OwnerTemplate {
  return {
    name: template.name,
    slug: template.slug,
    kind: "template",
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? null,
    variables: (template.variables ?? null) as EmailTemplateVariable[] | null,
    useLayout: template.useLayout ?? true,
    description: template.description ?? null,
    replyTo: template.replyTo ?? null,
    carriesSecret: template.carriesSecret,
  };
}

/**
 * Whether a template carries a secret: its running owner's mark, or the mark
 * stored from its owner's last declaration, so the template of a plugin that
 * is not running keeps it. Either one suffices, which is the safe way to be
 * wrong while the two disagree (a boot that has not reconciled yet).
 */
export function carriesSecret(
  slug: string,
  storedMark: boolean | null | undefined,
  registry: TemplateOwnerRegistry
): boolean {
  return (
    registry.owned.get(slug)?.carriesSecret === true || storedMark === true
  );
}

/**
 * What an owner says about a template beside its version: when it is sent,
 * and the data its code supplies. Neither changes what a send renders.
 */
export interface OwnerDetails {
  description: string | null;
  variables: EmailTemplateVariable[] | null;
}

export function detailsOf(template: {
  description?: string | null;
  variables?: unknown;
}): OwnerDetails {
  return {
    description: template.description ?? null,
    variables: (template.variables ?? null) as EmailTemplateVariable[] | null,
  };
}

/**
 * The owner's version an override is based on, as kept. `details` is what the
 * owner said about the template as of the site's copy: while the site's
 * details still equal it, the owner's later details replace them; once the
 * site has changed them, the site's stay. Absent on an override kept before
 * details were tracked, which then follows the owner's details.
 */
export type KeptBase = EmailTemplateVersion & { details?: OwnerDetails };

/** The configuration ownership is read from: the plugins and `email.templates`. */
export interface OwnershipConfig {
  plugins?: ReadonlyArray<{
    name: string;
    enabled?: boolean;
    contributes?: { emailTemplates?: ReadonlyArray<PluginEmailTemplate> };
  }>;
  email?: { templates?: EmailConfig["templates"] };
}

/**
 * The owners a configuration declares: each enabled plugin with the templates
 * it contributes, and the templates the site's code sets. Every boot path
 * reads ownership through this, so they cannot disagree.
 */
export function ownershipFromConfig(
  config: OwnershipConfig
): Pick<RegistryInput, "plugins" | "codeTemplates"> {
  return {
    plugins: (config.plugins ?? [])
      .filter(plugin => plugin.enabled !== false)
      .map(plugin => ({
        name: plugin.name,
        templates: plugin.contributes?.emailTemplates ?? [],
      })),
    codeTemplates: config.email?.templates,
  };
}

export interface RegistryInput {
  /** Core's built-in templates and layouts. */
  builtIns: ReadonlyArray<OwnerTemplate>;
  /** Each running plugin, with the templates it contributes. */
  plugins: ReadonlyArray<{
    name: string;
    templates: ReadonlyArray<PluginEmailTemplate>;
  }>;
  /** `email.templates` from `defineConfig()`. */
  codeTemplates?: EmailConfig["templates"];
  /** Whether `plugins` and `codeTemplates` are what is running (see TemplateOwnerRegistry.complete). */
  complete: boolean;
}

export interface RegistryConflict {
  slug: string;
  /** The owner that kept the slug. */
  kept: RegisteredOwner;
  /** The plugin whose contribution was ignored. */
  ignored: string;
}

/**
 * Build the registry from what core ships and the running plugins contribute.
 *
 * Core is registered first, so a plugin cannot take over one of core's slugs;
 * between two plugins the first one listed keeps a slug both contribute. Each
 * such collision is returned, so the caller can say which contribution was
 * ignored rather than dropping it silently.
 */
export function buildTemplateOwnerRegistry(input: RegistryInput): {
  registry: TemplateOwnerRegistry;
  conflicts: RegistryConflict[];
} {
  const map = new Map<string, OwnedTemplate>();
  const conflicts: RegistryConflict[] = [];

  for (const template of input.builtIns) {
    map.set(template.slug, owned({ kind: "core" }, template));
  }
  for (const plugin of input.plugins) {
    for (const template of plugin.templates) {
      const existing = map.get(template.slug);
      if (existing) {
        conflicts.push({
          slug: template.slug,
          kept: existing.owner,
          ignored: plugin.name,
        });
        continue;
      }
      map.set(
        template.slug,
        owned({ kind: "plugin", name: plugin.name }, pluginDefaults(template))
      );
    }
  }

  const setInCode = new Set<string>();
  for (const [slug, key] of Object.entries(CODE_TEMPLATE_KEYS)) {
    if (input.codeTemplates?.[key]) setInCode.add(slug);
  }

  return {
    registry: { owned: map, setInCode, complete: input.complete },
    conflicts,
  };
}

/** The stored owner columns, as written. */
export interface StoredOwner {
  ownerKind: string | null;
  ownerName: string | null;
}

/**
 * A stored row's owner as callers see it.
 *
 * Read from the stored columns once the boot reconciliation has written them.
 * A row it has not reached yet (the reconciliation runs after the server
 * starts answering) is read from the registry, so a core or plugin template is
 * never reported as the site's in the meantime.
 *
 * Before the running plugins are known (an incomplete registry), a plugin's
 * template counts as installed: that is the reading that refuses a delete,
 * which is the safe way to be wrong.
 */
export function ownerOf(
  slug: string,
  stored: StoredOwner,
  registry: TemplateOwnerRegistry
): EmailTemplateOwner {
  const registered = registry.owned.get(slug)?.owner ?? null;
  // Once the running owners are known, a registered owner decides: the stored
  // one can lag behind (a plugin just installed that contributes this slug)
  // until the boot's reconciliation writes it, and reading the stale one would
  // let a running plugin's template be deleted.
  const current =
    registry.complete && registered ? storedOwner(registered) : stored;
  const kind = current.ownerKind ?? registered?.kind ?? absentKind(slug);
  if (kind === "core") return { kind: "core" };
  if (kind === "plugin") {
    const name =
      current.ownerName ??
      (registered?.kind === "plugin" ? registered.name : null) ??
      absentPluginFor(slug) ??
      "unknown";
    const installed = registry.complete
      ? registered?.kind === "plugin" && registered.name === name
      : true;
    return { kind: "plugin", name, installed };
  }
  return { kind: "site" };
}

function absentKind(slug: string): "plugin" | "site" {
  return absentPluginFor(slug) ? "plugin" : "site";
}

/** The stored columns for an owner. */
export function storedOwner(
  owner: RegisteredOwner | EmailTemplateOwner
): StoredOwner {
  return {
    ownerKind: owner.kind,
    ownerName: owner.kind === "plugin" ? owner.name : null,
  };
}

/**
 * Whether two stored values are equal, whatever order their object keys come
 * back in. PostgreSQL's `jsonb` returns keys in an order of its own, so the
 * same declared variables read back differently from how they were written.
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    // A property set to undefined is left out, as JSON storage leaves it out.
    return `{${Object.keys(value)
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        key =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether an owner's template is one the site may not delete. */
export function isProtectedOwner(owner: EmailTemplateOwner): boolean {
  return owner.kind === "core" || (owner.kind === "plugin" && owner.installed);
}
