"use client";

import type { ReactNode } from "react";

import type { ReleaseDocumentRef } from "@admin/types/releases";
import type { PartReview } from "@admin/types/workflows";

import type { DocumentReviewBinding } from "../EntryForm/useDocumentActionBindings";

export interface EditorReviewInput {
  document: ReleaseDocumentRef | undefined;
  locale: string | undefined;
  canEdit: boolean;
  isDirty: boolean;
  storedStamp?: string;
}

export interface EditorReview {
  binding: DocumentReviewBinding | undefined;
  part: PartReview | undefined;
  dialog: ReactNode;
}

export function useEditorReview(_input: EditorReviewInput): EditorReview {
  return { binding: undefined, part: undefined, dialog: null };
}
