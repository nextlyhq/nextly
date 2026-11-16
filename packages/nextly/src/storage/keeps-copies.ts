/**
 * Whether a storage can keep files made from a stored one, such as resized
 * copies of an image, beside it: it must read the stored file back and write
 * at a key of core's choosing. One answer for everything that asks, so the
 * copies served and the copies removed are judged alike.
 *
 * @module storage/keeps-copies
 */
import type { IStorageAdapter } from "./types";

/** A storage that reads its files back and writes at a key it is given. */
export type CopyKeepingStorage<T extends Partial<IStorageAdapter>> = T &
  Required<Pick<IStorageAdapter, "read" | "uploadAt">>;

/** Whether `storage` can keep copies beside its files. */
export function keepsCopies<T extends Partial<IStorageAdapter>>(
  storage: T | null | undefined
): storage is CopyKeepingStorage<T> {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.read === "function" &&
    typeof storage.uploadAt === "function"
  );
}
