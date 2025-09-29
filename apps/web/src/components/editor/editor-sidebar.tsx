"use client";

import {
  VideoIcon,
  MusicIcon,
  TypeIcon,
  CaptionsIcon,
  StickerIcon,
  SparklesIcon,
  ArrowLeftRightIcon,
  BlendIcon,
  SlidersHorizontalIcon,
  SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useMediaPanelStore, Tab } from "./media-panel/store";
import { usePanelStore } from "@/stores/panel-store";

const sidebarItems: Array<{
  tab: Tab;
  label: string;
  icon: LucideIcon;
}> = [
  { tab: "media", label: "Video", icon: VideoIcon },
  { tab: "sounds", label: "Sounds", icon: MusicIcon },
  { tab: "text", label: "Text", icon: TypeIcon },
  { tab: "captions", label: "Captions", icon: CaptionsIcon },
  { tab: "stickers", label: "Stickers", icon: StickerIcon },
  { tab: "effects", label: "Effects", icon: SparklesIcon },
  { tab: "transitions", label: "Transitions", icon: ArrowLeftRightIcon },
  { tab: "filters", label: "Filters", icon: BlendIcon },
  { tab: "adjustment", label: "Adjustment", icon: SlidersHorizontalIcon },
  { tab: "settings", label: "Settings", icon: SettingsIcon },
];

export function EditorSidebar() {
  const { activeTab, setActiveTab } = useMediaPanelStore();
  const { isMediaPanelOpen, setMediaPanelOpen } = usePanelStore();

  const handleItemClick = (tab: Tab) => {
    if (activeTab === tab) {
      setMediaPanelOpen(!isMediaPanelOpen);
      return;
    }
    setActiveTab(tab);
    if (!isMediaPanelOpen) {
      setMediaPanelOpen(true);
    }
  };

  return (
    <aside className="hidden lg:flex w-20 flex-col items-center border-r border-border/40 bg-surface-elevated/90 px-3 py-6 backdrop-blur">
      <div className="flex flex-1 flex-col items-center gap-4">
        {sidebarItems.map(({ tab, label, icon: Icon }) => {
          const isActive = activeTab === tab && isMediaPanelOpen;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => handleItemClick(tab)}
              className={cn(
                "flex w-full flex-col items-center gap-1 text-xs font-medium transition",
                isActive ? "text-white" : "text-muted-foreground hover:text-white"
              )}
            >
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-xl border border-transparent transition",
                  isActive
                    ? "bg-quick-action shadow-soft"
                    : "bg-surface-base/70 hover:bg-surface-base/90 border-border/40"
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[0.65rem] tracking-wide uppercase">
                {label}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setMediaPanelOpen(!isMediaPanelOpen)}
        className="mt-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border/40 text-muted-foreground transition hover:text-white"
        title={isMediaPanelOpen ? "Collapse media panel" : "Expand media panel"}
      >
        {isMediaPanelOpen ? (
          <ChevronsLeft className="h-5 w-5" />
        ) : (
          <ChevronsRight className="h-5 w-5" />
        )}
      </button>
    </aside>
  );
}
