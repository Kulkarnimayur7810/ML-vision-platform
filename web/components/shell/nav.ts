import { LayoutDashboard, KanbanSquare, Users, Settings, Images, PenTool, Cpu, FlaskConical, Activity, GitCompareArrows, Boxes, BookOpen, LifeBuoy, type LucideIcon } from "lucide-react";
export type NavItem = { key: string; label: string; href: string; icon: LucideIcon };
// Only pages that are actually implemented are listed. New phases add their entries here.
export const NAV: NavItem[] = [
  { key: "overview", label: "Overview", href: "", icon: LayoutDashboard },
  { key: "datasets", label: "Datasets", href: "/datasets", icon: Images },
  { key: "annotate", label: "Annotation", href: "/annotate", icon: PenTool },
  { key: "training", label: "Training", href: "/training", icon: Cpu },
  { key: "experiments", label: "Experiments", href: "/experiments", icon: GitCompareArrows },
  { key: "models", label: "Models", href: "/models", icon: Boxes },
  { key: "predict", label: "Test & Predict", href: "/predict", icon: FlaskConical },
  { key: "jobs", label: "Jobs & workers", href: "/jobs", icon: Activity },
  { key: "kanban", label: "Team Kanban", href: "/kanban", icon: KanbanSquare },
  { key: "team", label: "Team", href: "/team", icon: Users },
  { key: "docs", label: "Documentation", href: "/docs", icon: BookOpen },
  { key: "help", label: "Guide", href: "/help", icon: LifeBuoy },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];
