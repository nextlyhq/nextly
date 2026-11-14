/** A second page built in code, which is not the home page. */
import { seoMetadata } from "@nextlyhq/plugin-seo";

export const generateMetadata = () =>
  seoMetadata("/about", { metadata: { title: "About" } });

export default function AboutPage() {
  return <h1>About</h1>;
}
