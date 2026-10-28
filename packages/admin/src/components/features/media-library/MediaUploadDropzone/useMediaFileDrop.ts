"use client";

/**
 * useMediaFileDrop
 *
 * Makes an element take files dropped from outside the page, and gives it a
 * file chooser to open, with the checks the admin can make before an upload:
 * the types and the per-file size the server accepts. What passes, and what
 * is refused with its reason, goes to `onFiles` as one batch, for the upload
 * queue. The library's whole page and the media picker's drop area are both
 * built on it, so they refuse the same files for the same reasons.
 *
 * Only files count. React Dropzone shows a drag as active only when its
 * `dataTransfer.types` holds "Files", and a drag that started on this page,
 * such as an image dragged off a tile, is ignored outright, because some
 * browsers offer a dragged image as a file too.
 */

import * as React from "react";
import {
  useDropzone,
  type DropzoneState,
  type FileRejection,
} from "react-dropzone";

import type { DroppedFiles } from "../UploadTray/useUploadQueue";

import {
  DEFAULT_ACCEPTED_FILE_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  describeFileError,
  getAcceptDescription,
  parseAcceptString,
} from "./upload-limits";

/**
 * Splits what React Dropzone hands back into the files to send and the files
 * refused, each refusal with a reason a person can read. Every file a person
 * drops is taken: there is no cap on how many.
 */
export function sortDroppedFiles(
  acceptedFiles: File[],
  fileRejections: Pick<FileRejection, "file" | "errors">[],
  maxSize: number
): DroppedFiles {
  return {
    accepted: acceptedFiles,
    refused: fileRejections.map(({ file, errors }) => ({
      file,
      reason: errors.map(e => describeFileError(e, maxSize)).join(", "),
    })),
  };
}

/**
 * True from the moment a drag starts on this page until it ends, so a drop
 * target can tell a drag from inside the page from files from outside: only
 * the first fires `dragstart` in this document.
 */
function useDragFromThisPage(): boolean {
  const [dragging, setDragging] = React.useState(false);
  React.useEffect(() => {
    const start = () => setDragging(true);
    const end = () => setDragging(false);
    // `drop` as well as `dragend`: a drag whose source left the page while
    // it moved never brings its `dragend` back to the document, and the
    // flag would then refuse every later drop of real files.
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
    };
  }, []);
  return dragging;
}

export interface MediaFileDrop
  extends Pick<
    DropzoneState,
    "getRootProps" | "getInputProps" | "isDragActive" | "isDragReject" | "open"
  > {
  /** The types and size the drop takes, to state before an upload. */
  description: string;
  /** The per-file size the drop refuses above, in bytes. */
  maxSize: number;
}

export function useMediaFileDrop({
  accept,
  maxFileSize,
  disabled = false,
  onFiles,
}: {
  /** A MIME filter such as "image/*"; the server's own list when absent. */
  accept?: string;
  /** Bytes; the server's default limit when absent. */
  maxFileSize?: number;
  /** For a person who may not upload: no drop target and no chooser. */
  disabled?: boolean;
  onFiles: (files: DroppedFiles) => void;
}): MediaFileDrop {
  const acceptedFileTypes = React.useMemo(
    () => parseAcceptString(accept) || DEFAULT_ACCEPTED_FILE_TYPES,
    [accept]
  );
  const maxSize = maxFileSize || DEFAULT_MAX_FILE_SIZE;
  const description = React.useMemo(
    () => getAcceptDescription(accept, maxSize),
    [accept, maxSize]
  );
  const dragFromThisPage = useDragFromThisPage();

  // `noClick` and `noKeyboard`: the element is a region of the page, not a
  // button, and the chooser opens only through `open`, from a real button.
  //
  // Why the drag callbacks are passed as `undefined`: react-dropzone 14.3
  // declares its options as `Pick<React.HTMLProps<HTMLElement>, "multiple" |
  // "onDragEnter" | "onDragOver" | "onDragLeave"> & {...}`, and against the
  // React 19 types those four arrive as required. The hook handles drags
  // itself, so stating them keeps the type honest without a cast.
  //
  // No `maxFiles`: it refuses the WHOLE batch past the limit, and a drop of
  // any size is taken.
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      accept: acceptedFileTypes,
      maxSize,
      multiple: true,
      disabled,
      noDrag: dragFromThisPage,
      noClick: true,
      noKeyboard: true,
      onDrop: (acceptedFiles, fileRejections) => {
        onFiles(sortDroppedFiles(acceptedFiles, fileRejections, maxSize));
      },
      onDragEnter: undefined,
      onDragOver: undefined,
      onDragLeave: undefined,
    });

  return {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    open,
    description,
    maxSize,
  };
}
