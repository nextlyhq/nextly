import { revalidateTag } from "next/cache";

// Mechanism b: an authenticated route a writer outside a request calls with
// the tags it changed.
export async function POST(request: Request) {
  if (request.headers.get("x-lab-secret") !== process.env.LAB_SECRET) {
    return new Response("refused", { status: 401 });
  }
  const { tags } = (await request.json()) as { tags: string[] };
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ expired: tags });
}
