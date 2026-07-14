/**
 * Registers the 8 built-in block renderers into `defaultBlockRegistry` as a side
 * effect. Importing this (done by the "./render" entry) makes them available to
 * PageRenderer and the editor canvas.
 */
export { paragraph } from "./paragraph";
export { heading } from "./heading";
export { image } from "./image";
export { button } from "./button";
export { video } from "./video";
export { container } from "./container";
export { grid } from "./grid";
export { queryLoop } from "./queryLoop";
export { spacer } from "./spacer";
export { divider } from "./divider";
export { anchor } from "./anchor";
export { badge } from "./badge";
export { icon } from "./icon";
export { list } from "./list";
export { iconList } from "./iconList";
export { buttonGroup } from "./buttonGroup";
export { columns } from "./columns";
export { cover } from "./cover";
export { iconBox } from "./iconBox";
export { imageBox } from "./imageBox";
export { gallery } from "./gallery";
export { richText } from "./richText";
export { tabs } from "./tabs";
export { accordion } from "./accordion";
export { table } from "./table";
export { socialIcons } from "./socialIcons";
export { embed } from "./embed";
