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

export type EmailProviderType = "smtp" | "resend" | "sendlayer";

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
}

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
}

// ============================================================
// API Functions
// ============================================================

/**
 * List email providers (no server-side pagination).
 *
 * Phase 4 (Task 19): the email-provider dispatcher emits
 * `respondData({ providers })` (not respondList) because the underlying
 * service returns the full unpaginated array. We therefore type the
 * fetcher with the bare `{ providers }` shape and synthesise a
 * single-page PaginationMeta locally so the existing callers keep
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
  if (params.type && params.type !== "all") {
    queryParts.push(`type=${params.type}`);
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
 * Get a single email provider by ID.
 *
 * Phase 4 (Task 19): findByID returns the bare doc via respondDoc.
 */
export async function getProvider(id: string): Promise<EmailProviderRecord> {
  return fetcher<EmailProviderRecord>(`/email-providers/${id}`, {}, true);
}

/**
 * Create a new email provider.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<EmailProviderRecord>`;
 * project `item` to keep the public bare-record signature.
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
 *
 * Phase 4 (Task 19): server returns `MutationResponse<EmailProviderRecord>`;
 * project `item` to keep the public bare-record signature.
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
 * Delete an email provider.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<EmailProviderRecord>`;
 * we discard the body since the caller expects void.
 */
export async function deleteProvider(id: string): Promise<void> {
  await fetcher<MutationResponse<EmailProviderRecord>>(
    `/email-providers/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Set an email provider as the default.
 *
 * Phase 4 (Task 19): non-CRUD mutation returning `ActionResponse`; we
 * discard the body.
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
 * When `email` is supplied it is used as the destination; otherwise the
 * server falls back to the provider's configured fromEmail.
 *
 * Phase 4 (Task 19): the test endpoint emits
 * `respondAction("Test email dispatched.", { result })`, so the wire body
 * is `{ message, result: TestProviderResult }`. Project `result` to keep
 * the legacy public signature.
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

export const emailProviderApi = {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  testProvider,
} as const;
