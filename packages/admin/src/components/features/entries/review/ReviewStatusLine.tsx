"use client";

import type { JSX } from "react";

import type { PartReview } from "@admin/types/workflows";

export function ReviewStatusLine(_props: {
  status: string;
  hasWorkingDraft: boolean;
  part: PartReview | undefined;
}): JSX.Element | null {
  return null;
}
