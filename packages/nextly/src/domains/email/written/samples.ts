/**
 * One of each written block, with each mark and chip form a block can carry,
 * and sample data for them. Pinned by the golden render test, and what the
 * sample sends for client screenshots carry. Sample data only: nothing here
 * is a real address, link, token or secret.
 *
 * @module domains/email/written/samples
 */

import type { WrittenBlock } from "./document";

export const WRITTEN_SAMPLES: Record<string, WrittenBlock> = {
  heading: {
    type: "heading",
    text: [
      { type: "text", text: "Order " },
      { type: "chip", variable: "order.number", fallback: "pending" },
    ],
  },
  text: {
    type: "text",
    text: [
      { type: "text", text: "Hi " },
      { type: "chip", variable: "name", fallback: "there", bold: true },
      { type: "text", text: ", thanks for your order.\nRead the " },
      {
        type: "text",
        text: "terms",
        italic: true,
        link: { url: "https://shop.example/terms" },
      },
      { type: "text", text: " or " },
      {
        type: "text",
        text: "track it",
        link: { chip: { variable: "trackUrl" } },
      },
      { type: "text", text: "." },
    ],
  },
  button: {
    type: "button",
    label: [{ type: "text", text: "View your order" }],
    link: {
      chip: { variable: "orderUrl", fallback: "https://shop.example/orders" },
    },
  },
  image: {
    type: "image",
    src: { url: "https://shop.example/banner.png" },
    alt: [{ type: "text", text: "Spring sale" }],
    width: 480,
  },
  divider: { type: "divider" },
  spacer: { type: "spacer", height: 32 },
  list: {
    type: "list",
    variable: "lines",
    blocks: [
      {
        type: "text",
        text: [
          { type: "chip", variable: "item.name" },
          { type: "text", text: " × " },
          { type: "chip", variable: "item.quantity" },
          { type: "text", text: " — " },
          { type: "chip", variable: "item.total" },
        ],
      },
    ],
  },
  conditional: {
    type: "text",
    text: [{ type: "text", text: "Your coupon has been applied." }],
    show: { variable: "coupon", when: "present" },
  },
};

/** Data that fills every chip the samples carry. */
export const WRITTEN_SAMPLE_DATA: Record<string, unknown> = {
  appName: "Shop",
  year: "2026",
  name: "Priya",
  order: { number: "1042" },
  trackUrl: "https://shop.example/t/1042",
  orderUrl: "https://shop.example/orders/1042",
  lines: [
    { name: "Tea", quantity: 2, total: "$8.00" },
    { name: "Cake", quantity: 1, total: "$6.00" },
  ],
  coupon: "SPRING",
};
