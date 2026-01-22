"use client"

import { memo } from "react"
import type React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Library,
  Disc3,
  ListMusic,
  Heart,
  Clock,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Folder,
} from "lucide-react"

import type { MusicFolder } from "@/lib/types"

interface SidebarProps {
  view: "library" | "nowplaying" | "queue" | "artist" | "favorites" | "recent"
  setView: (view: "library" | "nowplaying" | "queue" | "artist" | "favorites" | "recent") => void
  onOpenSettings: () => void
  onAddFolder: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  folders: MusicFolder[]
  onFolderSelect: (folder: MusicFolder) => void
}

export const Sidebar = memo(function Sidebar({
  view,
  setView,
  onOpenSettings,
  collapsed,
  onToggleCollapse,
  folders,
  onFolderSelect,
}: SidebarProps) {
  const NavButton = ({
    icon: Icon,
    label,
    isActive,
    onClick,
  }: {
    icon: React.ElementType
    label: string
    isActive?: boolean
    onClick?: () => void
  }) => {
    const button = (
      <Button
        variant={isActive ? "secondary" : "ghost"}
        className={cn(
          "h-10 rounded-xl transition-all duration-200",
          collapsed ? "w-10 p-0 justify-center" : "w-full justify-start gap-3",
          isActive && "bg-secondary",
        )}
        onClick={onClick}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && <span>{label}</span>}
      </Button>
    )

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" className="rounded-lg">
            {label}
          </TooltipContent>
        </Tooltip>
      )
    }
    return button
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out",
          collapsed ? "w-14" : "w-50",
        )}
      >
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {!collapsed && (
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Menu</p>
            )}

            <NavButton
              icon={Disc3}
              label="Now Playing"
              isActive={view === "nowplaying"}
              onClick={() => setView("nowplaying")}
            />
            <NavButton
              icon={ListMusic}
              label="Queue"
              isActive={view === "queue"}
              onClick={() => setView("queue")}
            />
            <NavButton
              icon={Library}
              label="Library"
              isActive={view === "library"}
              onClick={() => setView("library")}
            />

            <NavButton 
              icon={Clock} 
              label="Recent" 
              isActive={view === "recent"}
              onClick={() => setView("recent")}
            />
            <NavButton 
              icon={Heart} 
              label="Favorites" 
              isActive={view === "favorites"}
              onClick={() => setView("favorites")}
            />
          </div>

          <Separator className="my-4" />

           <div className="space-y-1">
            {!collapsed && (
              <p className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Library</p>
            )}
             {folders.filter(f => !f.parentId).map(folder => (
                <NavButton 
                  key={folder.id} 
                  icon={Folder} 
                  label={folder.name} 
                  onClick={() => onFolderSelect(folder)} 
                />
             ))}
          </div>
        </ScrollArea>

        <div className="p-2 space-y-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "h-10 rounded-xl transition-all duration-200",
                  collapsed ? "w-10 p-0 justify-center" : "w-full justify-start gap-3",
                )}
                onClick={onToggleCollapse}
              >
                {collapsed ? (
                  <PanelLeft className="w-4 h-4 shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose className="w-4 h-4 shrink-0" />
                    <span>Collapse</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right" className="rounded-lg">
                Expand
              </TooltipContent>
            )}
          </Tooltip>

          <NavButton icon={Settings} label="Settings" onClick={onOpenSettings} />

        </div>
      </aside>
    </TooltipProvider>
  )
})
