/**
 * `GET` answers the note as this instance's cache holds it. `POST { value }`
 * writes it inside a request, the way an editor's save does; it needs the
 * `x-fixture-secret` header the driver starts each instance with, so nothing
 * else can write.
 */
import { connection } from "next/server";
import { getNextly } from "nextly";

import { readNote, writeNote } from "../../../lib/note";
import config from "../../../nextly.config";

export async function GET(): Promise<Response> {
  // A request-time read, so the answer comes from the cache rather than a
  // response prerendered at build.
  await connection();
  return Response.json({ value: await readNote() });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.FIXTURE_WRITE_SECRET;
  if (!secret || request.headers.get("x-fixture-secret") !== secret) {
    return new Response(null, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    value?: unknown;
  } | null;
  if (typeof body?.value !== "string") {
    return Response.json({ error: "value must be a string" }, { status: 400 });
  }
  await writeNote(await getNextly({ config }), body.value);
  return Response.json({ value: body.value });
}
