"use client";

import { FileText, FolderKanban, Bot } from "lucide-react";

export type MobileTab = "notes" | "projects" | "agents";

interface BottomTabsProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}

const tabs: { id: MobileTab; label: string; icon: typeof FileText }[] = [
  { id: "notes", label: "Notes", icon: FileText },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "agents", label: "Agents", icon: Bot },
];

export function BottomTabs({ activeTab, onTabChange }: BottomTabsProps) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t">
      <div className="flex items-stretch h-12" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors active:bg-accent/50 ${
              activeTab === tab.id
                ? "text-primary"
                : "text-muted-foreground"
            }`}
          >
            <tab.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
