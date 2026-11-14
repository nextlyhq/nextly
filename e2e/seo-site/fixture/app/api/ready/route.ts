/** Answers once the site serves, reading nothing, so waiting for it fills no cache. */
import { connection } from "next/server";

export async function GET(): Promise<Response> {
  await connection();
  return Response.json({ ready: true });
}
