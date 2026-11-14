/** The home page, built in code, its head answered by the SEO plugin. */
import { seoMetadata } from "@nextlyhq/plugin-seo";

export const generateMetadata = () =>
  seoMetadata("/", { metadata: { title: "Home" } });

export default function HomePage() {
  return <h1>Home</h1>;
}
