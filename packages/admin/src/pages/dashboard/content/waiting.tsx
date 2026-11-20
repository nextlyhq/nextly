"use client";

/**
 * The "Waiting for my review" page: what waits for the reader's review across collections and
 * Singles, opened from the Content panel.
 *
 * @module pages/dashboard/content/waiting
 */
import type { JSX } from "react";

import { WaitingForMyReview } from "@admin/components/features/content/waiting/WaitingForMyReview";

export default function ContentWaitingPage(): JSX.Element {
  return <WaitingForMyReview />;
}
