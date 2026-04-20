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
 * const { data, meta } = await emailProviderApi.listProviders({ page: 0, pageSize: 10, search: '' });
 * const provider = await emailProviderApi.getProvider('provider-id');
 * ```
 */

import { enhancedFetcher } from "../lib/api/enhancedFetcher";
import { normalizePagination } from "../lib/api/normalizePagination";

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
 * List email providers with pagination and search.
 * Backend returns 1-based pages; this function converts to/from 0-based.
 */
export async function listProviders(params: {
  page: number;
  pageSize: number;
  search: string;
  type?: EmailProviderType | "all";
}): Promise<EmailProviderListResponse> {
  const queryParts: string[] = [
    `pageSize=${params.pageSize}`,
    `page=${params.page + 1}`, // Backend is 1-based
  ];
  if (params.search) {
    queryParts.push(`search=${encodeURIComponent(params.search)}`);
  }
  if (params.type && params.type !== "all") {
    queryParts.push(`type=${params.type}`);
  }
  const query = queryParts.join("&");

  const result = await enhancedFetcher<
    EmailProviderRecord[],
    Record<string, unknown>
  >(`/email-providers?${query}`, {}, true);

  const providers = result.data;
  const meta = normalizePagination(
    result.meta,
    params.pageSize,
    providers.length
  );

  return { data: providers, meta };
}

/**
 * Get a single email provider by ID.
 */
export async function getProvider(id: string): Promise<EmailProviderRecord> {
  const result = await enhancedFetcher<EmailProviderRecord>(
    `/email-providers/${id}`,
    {},
    true
  );
  return result.data;
}

/**
 * Create a new email provider.
 */
export async function createProvider(
  data: CreateEmailProviderPayload
): Promise<EmailProviderRecord> {
  const result = await enhancedFetcher<EmailProviderRecord>(
    `/email-providers`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
    true
  );
  return result.data;
}

/**
 * Update an existing email provider.
 */
export async function updateProvider(
  id: string,
  data: UpdateEmailProviderPayload
): Promise<EmailProviderRecord> {
  const result = await enhancedFetcher<EmailProviderRecord>(
    `/email-providers/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
    true
  );
  return result.data;
}

/**
 * Delete an email provider.
 */
export async function deleteProvider(id: string): Promise<void> {
  await enhancedFetcher<null>(
    `/email-providers/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Set an email provider as the default.
 */
export async function setDefaultProvider(id: string): Promise<void> {
  await enhancedFetcher<null>(
    `/email-providers/${id}/default`,
    { method: "PATCH" },
    true
  );
}

/**
 * Send a test email using the specified provider.
 * When `email` is supplied it is used as the destination; otherwise the
 * server falls back to the provider's configured fromEmail.
 */
export async function testProvider(
  id: string,
  email?: string
): Promise<TestProviderResult> {
  const result = await enhancedFetcher<TestProviderResult>(
    `/email-providers/${id}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(email ? { email } : {}),
    },
    true
  );
  return result.data;
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
