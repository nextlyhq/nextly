/**
 * Single API Playground Page
 *
 * Accessible via /admin/singles/[slug]/api.
 *
 * A wrapper rather than an implementation: the collection and single routes
 * showed the same page and were kept as two copies, which drifted. The page
 * itself lives in `ApiPlaygroundPage`.
 *
 * @module pages/dashboard/singles/[slug]/api
 * @since 1.0.0
 */

import { ApiPlaygroundPage } from "@admin/components/features/entries/APIPlayground";

interface SingleAPIPlaygroundPageProps {
  params?: {
    slug?: string;
  };
}

export default function SingleAPIPlaygroundPage({
  params,
}: SingleAPIPlaygroundPageProps) {
  return <ApiPlaygroundPage kind="single" slug={params?.slug} />;
}
