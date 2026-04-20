/**
 * Direct API Media Type Definitions
 *
 * Argument types for upload, find, update, delete operations on media files
 * and media folders.
 *
 * @packageDocumentation
 */

import type { DirectAPIConfig } from "./shared";

/**
 * File data for upload operations.
 *
 * Represents a file to be uploaded to the media library.
 */
export interface UploadFileData {
  /** File content as Buffer */
  data: Buffer;

  /** Original filename (e.g., 'photo.jpg') */
  name: string;

  /** MIME type (e.g., 'image/jpeg', 'video/mp4') */
  mimetype: string;

  /** File size in bytes */
  size: number;
}

/**
 * Arguments for uploading a media file.
 *
 * @example
 * ```typescript
 * import fs from 'fs';
 *
 * const buffer = fs.readFileSync('./image.png');
 * const media = await nextly.media.upload({
 *   file: {
 *     data: buffer,
 *     name: 'image.png',
 *     mimetype: 'image/png',
 *     size: buffer.length,
 *   },
 *   altText: 'My image',
 *   folder: 'uploads',
 * });
 * ```
 */
export interface UploadMediaArgs extends DirectAPIConfig {
  /** File to upload (required) */
  file: UploadFileData;

  /** Alternative text for accessibility */
  altText?: string;

  /** Folder ID to upload into (defaults to root) */
  folder?: string;
}

/**
 * Arguments for finding media files.
 *
 * @example
 * ```typescript
 * const images = await nextly.media.find({
 *   folder: 'folder-id',
 *   mimeType: 'image',
 *   limit: 20,
 * });
 * ```
 */
export interface FindMediaArgs extends DirectAPIConfig {
  /** Filter by folder ID */
  folder?: string;

  /** Filter by media type ('image', 'video', 'audio', 'document', 'other') */
  mimeType?: string;

  /** Search query (filename, altText) */
  search?: string;

  /** Maximum files per page */
  limit?: number;

  /** Page number (1-indexed) */
  page?: number;

  /** Sort field */
  sortBy?: "uploadedAt" | "filename" | "size";

  /** Sort direction */
  sortOrder?: "asc" | "desc";
}

/**
 * Arguments for finding a media file by ID.
 *
 * @example
 * ```typescript
 * const media = await nextly.media.findByID({ id: 'media-123' });
 * ```
 */
export interface FindMediaByIDArgs extends DirectAPIConfig {
  /** Media file ID (required) */
  id: string;
}

/**
 * Arguments for updating media metadata.
 *
 * @example
 * ```typescript
 * const updated = await nextly.media.update({
 *   id: 'media-123',
 *   data: { altText: 'Updated alt text', tags: ['photo', 'nature'] },
 * });
 * ```
 */
export interface UpdateMediaArgs extends DirectAPIConfig {
  /** Media file ID (required) */
  id: string;

  /** Update data */
  data: {
    /** Updated filename */
    filename?: string;
    /** Updated alt text */
    altText?: string | null;
    /** Updated caption */
    caption?: string | null;
    /** Updated tags */
    tags?: string[];
    /** Move to folder (null for root) */
    folderId?: string | null;
  };
}

/**
 * Arguments for deleting a media file.
 *
 * @example
 * ```typescript
 * await nextly.media.delete({ id: 'media-123' });
 * ```
 */
export interface DeleteMediaArgs extends DirectAPIConfig {
  /** Media file ID (required) */
  id: string;
}

/**
 * Arguments for bulk deleting media files.
 *
 * @example
 * ```typescript
 * const result = await nextly.media.bulkDelete({
 *   ids: ['media-1', 'media-2', 'media-3'],
 * });
 * ```
 */
export interface BulkDeleteMediaArgs extends DirectAPIConfig {
  /** Array of media file IDs to delete (required) */
  ids: string[];
}

/**
 * Arguments for listing media folders.
 *
 * @example
 * ```typescript
 * // List root folders
 * const rootFolders = await nextly.media.folders.list();
 *
 * // List subfolders
 * const subfolders = await nextly.media.folders.list({ parent: 'folder-id' });
 * ```
 */
export interface ListFoldersArgs extends DirectAPIConfig {
  /** Parent folder ID (defaults to root if not specified) */
  parent?: string;
}

/**
 * Arguments for creating a media folder.
 *
 * @example
 * ```typescript
 * const folder = await nextly.media.folders.create({
 *   name: 'Photos',
 *   description: 'Photo uploads',
 *   parent: 'parent-folder-id',
 * });
 * ```
 */
export interface CreateFolderArgs extends DirectAPIConfig {
  /** Folder name (required) */
  name: string;

  /** Description of the folder */
  description?: string;

  /** Folder color (for UI) */
  color?: string;

  /** Folder icon (for UI) */
  icon?: string;

  /** Parent folder ID (defaults to root) */
  parent?: string;
}
