/**
 * Email Provider API Service
 *
 * API client for managing email provider configurations.
 * Supports CRUD operations, set-default, and test email.
 *
 * @example
 * ```ts
 * import { emailProviderApi } from '@admin/services/emailProviderApi';
 *
 * const { data, meta } = await emailProviderApi.listProviders({ page: 0, limit: 10, search: '' });
 * const provider = await emailProviderApi.getProvider('provider-id');
 * ```
 */

import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";

// ============================================================
// Types
// ============================================================

/**
 * A provider type id, as stored on the record.
 *
 * Deliberately not a literal union. The set of providers is decided by the
 * server's registry at runtime — a plugin can contribute one — so a union
 * compiled into the admin could only ever describe the built-ins, and would
 * make every contributed provider a type error at the boundary that receives
 * it. The built-ins are kept as literals so editors still complete them.
 */
export type EmailProviderType = "smtp" | "resend" | "sendlayer" | (string & {});

/**
 * How one configuration value is entered, as the server describes it.
 *
 * Mirrors `EmailProviderConfigField` in core. It is a wire shape rather than a
 * shared import because the admin is built independently of the core package
 * and consumes it as JSON.
 */
export interface EmailProviderConfigField {
  /** Dotted path within `configuration`, e.g. `auth.pass`. */
  name: string;
  label: string;
  kind: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  help?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /** Credential. Never carries a value; read back masked. */
  secret?: boolean;
  constraints?: { min?: number; max?: number; maxLength?: number };
  /**
   * What a blank value means for this optional field.
   *
   * `"omit"` (the default) drops the key, which is what a parser written as
   * `z.string().min(1).optional()` accepts. `"empty"` sends `""`, for a key
   * nested inside a required object whose parser demands it exist.
   */
  blankAs?: "omit" | "empty";
}

/** What a provider can do, so the UI never offers what it cannot honour. */
export interface EmailProviderCapabilities {
  attachments?: boolean;
  connectionTest?: boolean;
  replyTo?: boolean;
  /** Only accepts a sender on a domain verified with the provider. */
  requiresVerifiedSender?: boolean;
}

/**
 * Whether the server can actually run this provider right now.
 *
 * A provider can be offered by the catalog and still be unusable, because the
 * transport library it needs is an optional peer dependency the host has not
 * installed. Mirrors `ProviderAvailability` in core: this is a wire contract
 * parsed from JSON rather than an imported type, so the two move together and
 * a change to one is a change to both.
 */
export type ProviderAvailability =
  | { status: "ready" }
  | {
      status: "needs-dependency";
      packageName: string;
      installCommand: string;
      docsUrl?: string;
    };

/**
 * The browser-safe half of a provider definition.
 *
 * Everything the form needs to render a provider the admin was never compiled
 * against, and nothing else: no stored values, no credentials.
 */
export interface EmailProviderDescriptor {
  type: EmailProviderType;
  label: string;
  description?: string;
  docsUrl?: string;
  /** One line about which sender addresses this provider accepts. */
  senderGuidance?: string;
  capabilities: EmailProviderCapabilities;
  configFields: EmailProviderConfigField[];
  /**
   * Optional on the CONSUMER side even though the server always sends it.
   *
   * Core populates this for every descriptor, so a matched server guarantees
   * it. The admin cannot guarantee the server it is talking to is matched, and
   * the notice that reads this already treats absence as "nothing to report" --
   * so declaring it required here would have the type promise something the
   * code deliberately does not rely on.
   */
  availability?: ProviderAvailability;
}

export interface EmailProviderRecord {
  id: string;
  name: string;
  type: EmailProviderType;
  fromEmail: string;
  fromName: string | null;
  configuration: Record<string, unknown>;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Whether the provider has verified the sending domain, where it reports
   * one. Only a single provider's read carries it; null when not reported.
   */
  domainStatus?: EmailDomainStatus | null;
}

/** What a provider reports about the domain email is sent from. */
export interface EmailDomainStatus {
  domain: string;
  status: "verified" | "pending" | "failed";
  records: Array<{
    type: string;
    name: string;
    value: string;
    /** An MX record's priority. */
    priority?: number;
  }>;
}

/**
 * What to check when a check or a test send fails: the key or password, the
 * sender or its domain, the recipient, a rate limit, the connection, or
 * something else.
 */
export type EmailSetupCategory =
  | "credentials"
  | "sender"
  | "recipient"
  | "rate-limited"
  | "connect"
  | "other";

export interface CreateEmailProviderPayload {
  name: string;
  type: EmailProviderType;
  fromEmail: string;
  fromName?: string | null;
  configuration: Record<string, unknown>;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdateEmailProviderPayload {
  name?: string;
  type?: EmailProviderType;
  fromEmail?: string;
  fromName?: string | null;
  configuration?: Record<string, unknown>;
  /**
   * Configuration fields to REMOVE, by the name the descriptor declares.
   *
   * Beside the values rather than inside them: a patch merged over stored
   * configuration can otherwise only say "leave it" or "set it", and every
   * in-band marker for "unset it" — `null`, `""`, a sentinel — is a value some
   * provider's parser legitimately accepts.
   */
  unsetConfiguration?: string[];
  isDefault?: boolean;
  isActive?: boolean;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EmailProviderListResponse {
  data: EmailProviderRecord[];
  meta: PaginationMeta;
}

export interface TestProviderResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** What to check, when the test failed. */
  setup?: EmailSetupCategory;
  /** Whether sending again later can succeed, when the provider said. */
  retryable?: boolean;
}

/**
 * What checking settings before saving found. `checked` is false when the
 * provider can't be asked without sending, so the test send is the check.
 */
export interface CheckProviderResult {
  checked: boolean;
  success: boolean;
  error?: string;
  setup?: EmailSetupCategory;
}

/** How email goes out when no provider is chosen. */
export interface SendingSettings {
  /** The default From address set in the site's code, if any. */
  from: string | null;
  /** The provider set in the site's code, by type and label only. */
  codeProvider: { type: string; label: string } | null;
  /** Whether the server runs in development, where Log is meant. */
  development: boolean;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List email providers (no server-side pagination).
 *
 * The email-provider dispatcher emits the bare `{ providers }` shape
 * because the underlying service returns the full unpaginated array.
 * We synthesise a single-page PaginationMeta locally so callers keep
 * receiving `{ data, meta }`.
 */
export async function listProviders(params: {
  page: number;
  limit?: number;
  search: string;
  type?: EmailProviderType | "all";
}): Promise<EmailProviderListResponse> {
  // The email-provider dispatcher returns the full unpaginated array via
  // respondData; we still emit `page` + `limit` so request logs are uniform
  // with paginated endpoints.
  const effectiveLimit = params.limit ?? 10;
  const queryParts: string[] = [
    `limit=${effectiveLimit}`,
    `page=${params.page + 1}`, // Backend is 1-based when it does paginate
  ];
  if (params.search) {
    queryParts.push(`search=${encodeURIComponent(params.search)}`);
  }
  // No sentinel to filter out. "No filter" is `undefined`, and every string
  // that arrives here is a provider type a plugin is entitled to register --
  // including `"all"`, which this once suppressed, so that provider could
  // never be filtered for.
  if (params.type) {
    queryParts.push(`type=${encodeURIComponent(params.type)}`);
  }
  const query = queryParts.join("&");

  const result = await fetcher<{ providers: EmailProviderRecord[] }>(
    `/email-providers?${query}`,
    {},
    true
  );

  const providers = result.providers ?? [];
  // Synthesize a single-page PaginationMeta so the table component keeps
  // working until the page is ported to the unpaginated shape.
  const meta: PaginationMeta = {
    page: 0,
    pageSize: effectiveLimit,
    total: providers.length,
    totalPages: 1,
  };

  return { data: providers, meta };
}

/**
 * List the provider types this installation can configure.
 *
 * The admin is compiled long before an install picks its plugins, so the set of
 * providers and the fields each one needs can only come from the server. This
 * is what lets the provider form render a provider nobody hardcoded.
 */
export async function listProviderTypes(): Promise<EmailProviderDescriptor[]> {
  const result = await fetcher<{ types: EmailProviderDescriptor[] }>(
    `/email-providers/types`,
    {},
    true
  );
  return result?.types ?? [];
}

/**
 * Get a single email provider by ID.
 */
export async function getProvider(id: string): Promise<EmailProviderRecord> {
  return fetcher<EmailProviderRecord>(`/email-providers/${id}`, {}, true);
}

/**
 * Create a new email provider.
 */
export async function createProvider(
  data: CreateEmailProviderPayload
): Promise<EmailProviderRecord> {
  const result = await fetcher<MutationResponse<EmailProviderRecord>>(
    `/email-providers`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    true
  );
  return result.item;
}

/**
 * Update an existing email provider.
 */
export async function updateProvider(
  id: string,
  data: UpdateEmailProviderPayload
): Promise<EmailProviderRecord> {
  const result = await fetcher<MutationResponse<EmailProviderRecord>>(
    `/email-providers/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    true
  );
  return result.item;
}

/**
 * Delete an email provider. Caller expects void; we discard the body.
 */
export async function deleteProvider(id: string): Promise<void> {
  await fetcher<MutationResponse<EmailProviderRecord>>(
    `/email-providers/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Set an email provider as the default. Caller expects void; we
 * discard the ActionResponse body.
 */
export async function setDefaultProvider(id: string): Promise<void> {
  await fetcher<ActionResponse>(
    `/email-providers/${id}/default`,
    { method: "PATCH" },
    true
  );
}

/**
 * Send a test email using the specified provider.
 * When `email` is supplied it is used as the destination; otherwise
 * the server falls back to the provider's configured fromEmail.
 */
export async function testProvider(
  id: string,
  email?: string
): Promise<TestProviderResult> {
  const body = await fetcher<ActionResponse<{ result: TestProviderResult }>>(
    `/email-providers/${id}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(email ? { email } : {}),
    },
    true
  );
  return body.result;
}

/**
 * Check settings with their provider before saving, sending nothing. For an
 * existing provider, pass its id and the fields the edit clears: masked
 * secrets then stand for the stored ones, and what is checked is what saving
 * would store. A configuration the provider can't accept is refused with the
 * fields to fix, as saving would refuse it.
 */
export async function checkProvider(input: {
  type: EmailProviderType;
  configuration: Record<string, unknown>;
  unsetConfiguration?: string[];
  providerId?: string;
}): Promise<CheckProviderResult> {
  // A saved provider is checked at its own address, as an edit; new settings
  // as an addition, which carries no provider's stored secrets.
  const { providerId, ...settings } = input;
  const path = providerId
    ? `/email-providers/${encodeURIComponent(providerId)}/check`
    : "/email-providers/check";
  const sent = providerId
    ? settings
    : { type: settings.type, configuration: settings.configuration };
  const body = await fetcher<ActionResponse<{ result: CheckProviderResult }>>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sent),
    },
    true
  );
  return body.result;
}

/** The default sender, the provider set in code, and the environment. */
export async function getSendingSettings(): Promise<SendingSettings> {
  const body = await fetcher<{ settings: SendingSettings }>(
    "/email-providers/settings",
    {},
    true
  );
  return body.settings;
}

/** The type of {@link emailProviderApi}. */
type EmailProviderApiType = {
  readonly listProviders: typeof listProviders;
  readonly listProviderTypes: typeof listProviderTypes;
  readonly getProvider: typeof getProvider;
  readonly createProvider: typeof createProvider;
  readonly updateProvider: typeof updateProvider;
  readonly deleteProvider: typeof deleteProvider;
  readonly setDefaultProvider: typeof setDefaultProvider;
  readonly testProvider: typeof testProvider;
  readonly checkProvider: typeof checkProvider;
  readonly getSendingSettings: typeof getSendingSettings;
};

export const emailProviderApi: EmailProviderApiType = {
  listProviders,
  listProviderTypes,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  testProvider,
  checkProvider,
  getSendingSettings,
} as const;
