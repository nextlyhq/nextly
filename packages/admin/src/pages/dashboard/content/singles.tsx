"use client";

/**
 * The Singles overview page: the Content overview with only its Singles table.
 *
 * @module pages/dashboard/content/singles
 */
import type { JSX } from "react";

import { ContentOverview } from "@admin/components/features/content-overview/ContentOverview";

export default function SinglesOverviewPage(): JSX.Element {
  return <ContentOverview scope="singles" />;
}
