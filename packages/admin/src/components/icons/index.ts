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

// Re-export types for type safety
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
