import { getNextly } from "nextly";
import nextlyConfig from "../configs/codefirst.config";

async function debug() {
  const nextly = await getNextly({ config: nextlyConfig });

  console.log("--- Categories ---");
  const cats = await nextly.find({ collection: "categories" });
  console.log(JSON.stringify(cats.items, null, 2));

  console.log("--- Posts ---");
  const posts = await nextly.find({ collection: "posts", depth: 0 });
  console.log(
    JSON.stringify(
      posts.items.map(p => ({
        id: p.id,
        title: p.title,
        categories: p.categories,
      })),
      null,
      2
    )
  );

  if (cats.items.length > 0) {
    const catId = cats.items[0].id;
    console.log(`--- Querying posts for category ID: ${catId} ---`);
    const results = await nextly.find({
      collection: "posts",
      where: {
        categories: { contains: catId },
      },
    });
    console.log(`Found ${results.meta.total} posts`);
  }
}

debug().catch(console.error);
