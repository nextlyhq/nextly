/**
 * Answers once the instance serves, without reading the note, so waiting for
 * an instance to start fills nothing in its cache.
 */
import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ ready: true });
}
