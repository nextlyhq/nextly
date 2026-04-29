/**
 * @nextly/client - REST API SDK for browser-based applications
 *
 * This package provides a type-safe client SDK for interacting with
 * Nextly from browser/client-side code.
 *
 * @example
 * ```typescript
 * import { NextlySDK } from '@nextly/client';
 *
 * const sdk = new NextlySDK({
 *   baseURL: '/api',
 * });
 *
 * const posts = await sdk.find({ collection: 'posts' });
 * ```
 *
 * @packageDocumentation
 */

export interface NextlySDKConfig {
  /**
   * Base URL for the Nextly REST API
   * @example '/api' or 'https://example.com/api'
   */
  baseURL: string;

  /**
   * Optional API key for authentication
   */
  apiKey?: string;
}

/**
 * REST API SDK for Nextly
 *
 * Provides a type-safe client for interacting with Nextly REST API
 * from browser-side code.
 *
 * @example
 * ```typescript
 * const sdk = new NextlySDK({ baseURL: '/api' });
 * const posts = await sdk.find({ collection: 'posts' });
 * ```
 */
export class NextlySDK {
  private config: NextlySDKConfig;

  constructor(config: NextlySDKConfig) {
    this.config = config;
  }

  /**
   * Find documents in a collection
   *
   * @param params - Query parameters
   * @returns Promise resolving to the query results
   *
   * @example
   * ```typescript
   * const posts = await sdk.find({ collection: 'posts' });
   * ```
   */
  find(params: { collection: string }): Promise<unknown> {
    // TODO: Implementation in Plan 7 (Local API & Client SDK)
    return Promise.reject(
      new Error(
        `Not implemented - placeholder for Plan 7. Collection: ${params.collection}`
      )
    );
  }

  /**
   * Find a single document by ID
   *
   * @param params - Query parameters including collection and ID
   * @returns Promise resolving to the document or null
   */
  findByID(params: { collection: string; id: string }): Promise<unknown> {
    // TODO: Implementation in Plan 7 (Local API & Client SDK)
    return Promise.reject(
      new Error(
        `Not implemented - placeholder for Plan 7. Collection: ${params.collection}, ID: ${params.id}`
      )
    );
  }

  /**
   * Create a new document
   *
   * @param params - Create parameters including collection and data
   * @returns Promise resolving to the created document
   */
  create(params: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<unknown> {
    // TODO: Implementation in Plan 7 (Local API & Client SDK)
    return Promise.reject(
      new Error(
        `Not implemented - placeholder for Plan 7. Collection: ${params.collection}`
      )
    );
  }

  /**
   * Update an existing document
   *
   * @param params - Update parameters including collection, ID, and data
   * @returns Promise resolving to the updated document
   */
  update(params: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown> {
    // TODO: Implementation in Plan 7 (Local API & Client SDK)
    return Promise.reject(
      new Error(
        `Not implemented - placeholder for Plan 7. Collection: ${params.collection}, ID: ${params.id}`
      )
    );
  }

  /**
   * Delete a document
   *
   * @param params - Delete parameters including collection and ID
   * @returns Promise resolving to the deletion result
   */
  delete(params: { collection: string; id: string }): Promise<unknown> {
    // TODO: Implementation in Plan 7 (Local API & Client SDK)
    return Promise.reject(
      new Error(
        `Not implemented - placeholder for Plan 7. Collection: ${params.collection}, ID: ${params.id}`
      )
    );
  }
}

// Re-export types
export type { NextlySDKConfig as NextlyClientConfig };
