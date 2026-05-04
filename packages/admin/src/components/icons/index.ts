/**
 * Icon barrel file for tree-shakable lucide-react imports
 *
 * @description Centralized icon exports to enable tree-shaking.
 * Only icons actually used in the codebase are exported here.
 * This reduces bundle size from ~400KB (all 1,400+ icons) to ~20KB (~60 icons).
 *
 * When adding new field types in useFields.ts, ensure the corresponding icon
 * is exported here to prevent runtime errors.
 *
 * @see https://lucide.dev/guide/packages/lucide-react
 * @see packages/admin/src/hooks/useFields.ts for field type icons
 */

import { LucideProps } from "lucide-react";
import React from "react";

export type { LucideIcon, LucideProps } from "lucide-react";

// Export icons used in components (alphabetically sorted)
export {
  Activity,
  ALargeSmall, // Rich text editor: font size selector
  AlertCircle,
  AlertTriangle,
  AlignCenter, // Rich text editor: text alignment
  AlignJustify, // Rich text editor: text alignment
  AlignLeft, // useFields: textarea
  AlignRight, // Rich text editor: text alignment
  Archive, // Collection Settings: icon picker
  ArrowDown, // Rich text editor: table actions
  ArrowLeft,
  ArrowLeftRight, // EntryCompare: swap indicator
  ArrowRight,
  ArrowUp, // Rich text editor: table actions
  Baseline, // Rich text editor: text color
  Bell, // Collection Settings: icon picker
  Bookmark, // Collection Settings: icon picker
  Bold, // Rich text editor
  Box,
  Braces, // Collection Builder: json field
  Briefcase, // Collection Settings: icon picker
  Building, // Collection Settings: icon picker
  Calendar, // useFields: date picker
  Camera, // Collection Settings: icon picker
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown, // Collection Builder: collapsible field
  ChevronUp,
  Circle, // useFields: radio
  Clipboard, // Collection Settings: icon picker
  Clock, // useFields: time picker
  Cloud, // AutoSaveIndicator: saved state
  CloudOff, // AutoSaveIndicator: not saved state
  ChevronDownSquare, // Rich text editor: collapsible
  Code, // Rich text editor
  Code2, // Rich text editor: code block
  Columns, // Collection Builder: row field
  Copy,
  CreditCard, // Collection Settings: icon picker
  Database,
  DollarSign, // Collection Settings: icon picker
  Download,
  Edit, // useFields: richtext
  ExternalLink, // RelationshipCard: edit link
  Eye,
  EyeOff,
  File,
  FileAudio, // UploadPreview: audio file icon
  FileImage, // UploadPreview: image file icon
  FileJson, // APIPlayground: empty state icon
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileVideo, // UploadPreview: video file icon
  Filter, // Table filters
  Flag, // Collection Settings: icon picker
  Folder,
  FolderInput, // Media Library: move to folder
  FolderOpen, // Collection Builder: group field
  FolderPlus,
  Github,
  Gift, // Collection Settings: icon picker
  Globe, // Collection Settings: icon picker
  GalleryHorizontalEnd, // Rich text editor: gallery
  Grid3x3,
  GripVertical,
  Hash, // useFields: number
  Heading2, // Rich text editor
  Heading3, // Rich text editor
  Heading4, // Rich text editor
  Heading5, // Rich text editor
  Heading6, // Rich text editor
  Heart, // Collection Settings: icon picker
  Highlighter, // Rich text editor: text highlight
  HelpCircle,
  Home,
  Image,
  Inbox, // Collection Settings: icon picker
  Info, // Field Editor: info boxes
  Italic, // Rich text editor
  Key,
  Laptop,
  LayoutGrid, // Collection Builder: blocks field
  Layers,
  LayoutDashboard,
  Library,
  Link,
  Link2, // useFields: relation
  List, // useFields: select
  ListOrdered, // Rich text editor
  Loader2,
  Lock, // useFields: password
  LogOut,
  Mail, // useFields: email
  Map, // Collection Settings: icon picker
  MapPin, // Collection Builder: point field
  Menu,
  MessageCircle, // Collection Settings: icon picker
  MessageSquare, // Collection Settings: icon picker
  Minus,
  MousePointerClick, // Rich text editor: button link
  Moon,
  MoreHorizontal,
  MoreVertical,
  Music,
  Package, // Collection Settings: icon picker
  Paintbrush, // Rich text editor: background color
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop, // Collection Builder: tabs field
  Paperclip, // Email Template editor: default attachments
  Pencil, // Collection Settings: icon picker
  Pilcrow, // Rich text editor: paragraph block type
  Phone, // Collection Settings: icon picker
  Play, // APIPlayground: execute request button
  Plus,
  Puzzle, // Component Builder: default component icon
  Quote, // Rich text editor
  Redo, // Rich text editor
  RefreshCw,
  RotateCcw, // Column visibility: reset to default
  RemoveFormatting, // Rich text editor
  SeparatorHorizontal, // Rich text editor: horizontal rule
  Save, // Collection Builder
  Search,
  Send, // Collection Settings: icon picker
  Settings,
  Shield,
  ShieldAlert,
  ShieldPlus,
  ShoppingBag, // Collection Settings: icon picker
  ShoppingCart, // Collection Settings: icon picker
  SlidersHorizontal, // EntryTableToolbar: filters
  Sparkles,
  Square,
  Star, // Collection Settings: icon picker
  Strikethrough, // Rich text editor
  Sun,
  Table, // Rich text editor: table
  Tag, // Collection Settings: icon picker
  Target, // Collection Settings: icon picker
  ToggleLeft, // useFields: boolean
  Trash,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck, // Collection Settings: icon picker
  Type, // useFields: text
  Underline, // Rich text editor
  Undo, // Rich text editor
  Upload,
  User, // useFields: user
  UserPlus,
  Users,
  Video,
  Wallet, // Collection Settings: icon picker
  X,
  XCircle,
  Zap, // Collection Settings: icon picker
} from "lucide-react";

// Icon aliases for compatibility
export { Check as CheckIcon } from "lucide-react";
export { ChevronDown as ChevronDownIcon } from "lucide-react";
export { ChevronUp as ChevronUpIcon } from "lucide-react";

/**
 * Custom Discord icon (Lucide-compatible)
 */
export const Discord = ({
  size = 24,
  ...props
}: LucideProps) => {
  return React.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 126.644 96",
      fill: "currentColor",
      ...props,
    },
    React.createElement("path", {
      d: "M81.15,0c-1.2376,2.1973-2.3489,4.4704-3.3591,6.794-9.5975-1.4396-19.3718-1.4396-28.9945,0-.985-2.3236-2.1216-4.5967-3.3591-6.794-9.0166,1.5407-17.8059,4.2431-26.1405,8.0568C2.779,32.5304-1.6914,56.3725.5312,79.8863c9.6732,7.1476,20.5083,12.603,32.0505,16.0884,2.6014-3.4854,4.8998-7.1981,6.8698-11.0623-3.738-1.3891-7.3497-3.1318-10.8098-5.1523.9092-.6567,1.7932-1.3386,2.6519-1.9953,20.281,9.547,43.7696,9.547,64.0758,0,.8587.7072,1.7427,1.3891,2.6519,1.9953-3.4601,2.0457-7.0718,3.7632-10.835,5.1776,1.97,3.8642,4.2683,7.5769,6.8698,11.0623,11.5419-3.4854,22.3769-8.9156,32.0509-16.0631,2.626-27.2771-4.496-50.9172-18.817-71.8548C98.9811,4.2684,90.1918,1.5659,81.1752.0505l-.0252-.0505ZM42.2802,65.4144c-6.2383,0-11.4159-5.6575-11.4159-12.6535s4.9755-12.6788,11.3907-12.6788,11.5169,5.708,11.4159,12.6788c-.101,6.9708-5.026,12.6535-11.3907,12.6535ZM84.3576,65.4144c-6.2637,0-11.3907-5.6575-11.3907-12.6535s4.9755-12.6788,11.3907-12.6788,11.4917,5.708,11.3906,12.6788c-.101,6.9708-5.026,12.6535-11.3906,12.6535Z",
    })
  );
};
