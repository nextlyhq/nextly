/**
 * The renderer's data seam (spec §10). The host injects an implementation (e.g. one
 * backed by `getNextly()`), so the renderer itself imports NO CMS runtime and stays
 * import-safe + testable. Query Loop (M6) uses `find`; Image uses denormalized props
 * in M3 and `resolveMedia` later.
 */
export interface FindArgs {
  collection: string;
  where?: unknown;
  sort?: string;
  limit?: number;
  populate?: unknown;
}

export interface ResolvedMedia {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface DataProvider {
  find(args: FindArgs): Promise<{ items: Record<string, unknown>[] }>;
  findOne(args: {
    collection: string;
    id: string;
  }): Promise<Record<string, unknown> | null>;
  resolveMedia(id: string): Promise<ResolvedMedia | null>;
}
