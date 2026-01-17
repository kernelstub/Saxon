"use client"

import { useState, useEffect, useRef } from "react"
import { Search, Music, Play } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { Track } from "@/lib/types"
import { getCurrentWindow } from "@tauri-apps/api/window"

interface HeaderProps {
  currentTrack: Track | null
  onSearch: (query: string) => void
  tracks: Track[]
  onPlayTrack: (track: Track) => void
}

export function Header({ onSearch, tracks, onPlayTrack }: HeaderProps) {
  const appWindow = getCurrentWindow()
  const [query, setQuery] = useState("")
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
      data-tauri-drag-region
      className="h-16 border-b border-border px-6 flex items-center justify-between select-none"
      onDoubleClick={toggleMaximize}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest("[data-no-drag]")) return
        appWindow.startDragging().catch(() => {})
      }}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        data-no-drag
        className="relative w-80"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
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
                    <p className="text-sm font-medium truncate">{track.title}</p>
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
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
      </div>
    </header>
  )
}
