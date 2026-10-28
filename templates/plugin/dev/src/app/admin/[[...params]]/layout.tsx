import { connection } from "next/server";

/**
 * The admin renders for each request, never from a cache another user's
 * request filled: under Cache Components a layout that reads no request data
 * would otherwise be prerendered once and served to everyone.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return children;
}
