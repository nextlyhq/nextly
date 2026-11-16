/**
 * The most media items one delete, or its Undo, may name.
 *
 * Each request is marked or brought back whole on one transaction, so a
 * selection of up to this many is deleted all or none; the work it does is
 * one row lock and one mark per item. The admin refuses a larger selection
 * before it asks, from this same number, so the two never disagree.
 *
 * @module domains/media/media-delete-limit
 */
export const MEDIA_DELETE_LIMIT = 1000;
