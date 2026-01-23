"use client"

import { useState, useEffect, useRef } from "react"
import { Search, Music, Play, Minus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { Track } from "@/lib/types"
import { getDisplayTitle } from "@/lib/utils"
import { getCurrentWindow } from "@tauri-apps/api/window"

interface HeaderProps {
  currentTrack: Track | null
  onSearch: (query: string) => void
  tracks: Track[]
  onPlayTrack: (track: Track) => void
  showWindowControls: boolean
  useNativeTitlebar: boolean
}

export function Header({ onSearch, tracks, onPlayTrack, showWindowControls, useNativeTitlebar }: HeaderProps) {
  const appWindow = getCurrentWindow()
  const [query, setQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const dragStyle = { WebkitAppRegion: "drag" } as any
  const noDragStyle = { WebkitAppRegion: "no-drag" } as any

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    onSearch(val)
    setShowDropdown(val.length > 0)
  }

  const searchResults = query 
    ? tracks.filter(t => 
        t.title.toLowerCase().includes(query.toLowerCase()) || 
        t.artist.toLowerCase().includes(query.toLowerCase()) || 
        t.album.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : []

  const toggleMaximize = async () => {
    const isMaximized = await appWindow.isMaximized()
    if (isMaximized) await appWindow.unmaximize()
    else await appWindow.maximize()
  }

  return (
    <header
      {...(!useNativeTitlebar ? { "data-tauri-drag-region": true } : {})}
      className="h-16 border-b border-border px-6 flex items-center justify-between select-none"
      onDoubleClick={toggleMaximize}
      onMouseDown={(e) => {
        if (useNativeTitlebar) return
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest("[data-no-drag]")) return
        appWindow.startDragging().catch(() => {})
      }}
      style={!useNativeTitlebar ? dragStyle : undefined}
    >
      <div
        data-no-drag
        className="relative w-80"
        style={noDragStyle}
        ref={dropdownRef}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search tracks, artists, albums..."
          className="pl-10 h-10 rounded-lg bg-secondary/50 border-transparent focus:border-border"
          onChange={handleSearch}
          onFocus={() => { if(query) setShowDropdown(true) }}
          value={query}
        />

        {showDropdown && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden">
            <div className="p-1">
              {searchResults.map((track) => (
                <button
                  key={track.id}
                  onClick={() => {
                    onPlayTrack(track)
                    setShowDropdown(false)
                  }}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary transition-colors text-left group"
                >
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden relative">
                    {track.coverUrl ? (
                        <img src={track.coverUrl} className="w-full h-full object-cover" />
                    ) : (
                        <Music className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{getDisplayTitle(track.title, track.artist)}</p>
                    <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        data-no-drag
        className="flex items-center gap-3"
        style={noDragStyle}
      >
        {showWindowControls && !useNativeTitlebar && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={async () => {
                try {
                  await appWindow.minimize()
                  return
                } catch {}
                try {
                  const { invoke } = await import("@tauri-apps/api/core")
                  await invoke("minimize_window")
                  return
                } catch {}
                try {
                  await appWindow.hide()
                } catch {}
              }}
            >
              <Minus className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core")
                  await invoke("exit_app")
                  return
                } catch {}
                try {
                  await appWindow.close()
                } catch {}
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
