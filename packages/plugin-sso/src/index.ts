/**
 * `@nextlyhq/plugin-sso` — Single Sign-On for Nextly.
 *
 * Adds Google, Microsoft (Entra ID) and GitHub sign-in on top of Nextly's own
 * auth pipeline. Core keeps everything security-critical and identical for
 * every login method — session issuance, JWT signing, cookies, CSRF, rate
 * limiting, account lockout and the audit trail. This plugin supplies only the
 * one thing core cannot know: which external identity a person just proved, and
 * which local user that maps to.
 *
 * The provider adapters, the plugin definition and the auth strategy land in
 * the phases that follow; this entry currently exposes the configuration
 * surface and the primitives behind the redirect flow.
 *
 * @module @nextlyhq/plugin-sso
 */

export {
  resolveSsoOptions,
  redirectUri,
  SsoConfigError,
  PLUGIN_NAME,
  type SsoOptions,
  type ResolvedSsoOptions,
  type ProviderKey,
  type GoogleProviderOptions,
  type MicrosoftProviderOptions,
  type GitHubProviderOptions,
} from "./config";

export { sanitizeNext, DEFAULT_NEXT } from "./redirect";
