/**
 * Curated lucide icon map shared by icon-bearing blocks (Icon, Icon List, Icon Box,
 * Social Icons). Server-safe: lucide components render to plain SVG. Mapped by NAME
 * (explicit object, not `import *`) so the bundle only pulls what we list. Expandable.
 */
import {
  ArrowRight,
  Award,
  Calendar,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Facebook,
  Github,
  Globe,
  Heart,
  Instagram,
  Layers,
  Lightbulb,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Star,
  ThumbsUp,
  TrendingUp,
  Twitter,
  Users,
  Youtube,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  ArrowRight,
  Award,
  Calendar,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Facebook,
  Github,
  Globe,
  Heart,
  Instagram,
  Layers,
  Lightbulb,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Rocket,
  Settings,
  Shield,
  Sparkles,
  Star,
  ThumbsUp,
  TrendingUp,
  Twitter,
  Users,
  Youtube,
  Zap,
};

export const ICON_NAMES = Object.keys(ICON_MAP);

/** Resolve an icon name to a lucide component, defaulting to Star. */
export function iconByName(name: string | undefined): LucideIcon {
  return (name && ICON_MAP[name]) || Star;
}
