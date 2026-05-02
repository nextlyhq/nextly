import {
  LayoutDashboard,
  Layers,
  Image as ImageIcon,
  Settings,
  Puzzle,
  Users,
  ShieldAlert,
  FileText,
} from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";

export type MainMenuCategory =
  | "dashboard"
  | "collections"
  | "singles"
  | "media"
  | "plugins"
  | "manage"
  | "settings"
  | "builders"
  | `standalone-${string}`;

export interface MainMenuItem {
  id: MainMenuCategory;
  label: string;
  icon: React.ElementType;
  href: string;
}

export const MAIN_MENU_ITEMS: MainMenuItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: ROUTES.DASHBOARD,
  },
  { id: "collections", label: "Collections", icon: Layers, href: "#" },
  { id: "singles", label: "Singles", icon: FileText, href: "#" },
  { id: "media", label: "Media Library", icon: ImageIcon, href: ROUTES.MEDIA },
  { id: "plugins", label: "Plugins", icon: Puzzle, href: "#" },
  { id: "manage", label: "Users", icon: Users, href: ROUTES.USERS },
  { id: "settings", label: "Settings", icon: Settings, href: ROUTES.SETTINGS },
  {
    id: "builders",
    label: "Builders",
    icon: ShieldAlert,
    href: ROUTES.COLLECTIONS,
  },
];

export const getFilteredMenuItems = (showBuilder: boolean) =>
  showBuilder
    ? MAIN_MENU_ITEMS
    : MAIN_MENU_ITEMS.filter(item => item.id !== "builders");
