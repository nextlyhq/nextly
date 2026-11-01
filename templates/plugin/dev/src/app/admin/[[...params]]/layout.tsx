import { connection } from "next/server";
import { Suspense } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <ForThisRequest>{children}</ForThisRequest>
    </Suspense>
  );
}

/**
 * The admin renders for each request, never from a cache another user's
 * request filled. Beneath the layout's Suspense boundary, so under Cache
 * Components the rest of the page still prerenders.
 */
async function ForThisRequest({ children }: { children: React.ReactNode }) {
  await connection();
  return children;
}
