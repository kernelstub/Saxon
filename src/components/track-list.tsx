import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { Track, MusicFolder } from "@/lib/types"
import { formatTime, cn, getDisplayTitle } from "@/lib/utils"
import { Play, MoreHorizontal, Heart, Folder, ChevronLeft, Trash2, ExternalLink, ListPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArtistLinks } from "@/components/artist-links"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { invoke } from "@tauri-apps/api/core"

interface TrackListProps {
  tracks: Track[]
  folders: MusicFolder[]
  currentTrack: Track | null
  onTrackSelect: (track: Track, contextTracks: Track[], contextLabel: string) => void
  onAddToQueue: (track: Track) => void
  contextLabel: string
  onSelectArtist: (artist: string) => void
  isPlaying: boolean
  selectedFolder: MusicFolder | null
  onFolderSelect: (folder: MusicFolder | null) => void
  favorites: string[]
  onToggleFavorite: (trackId: string) => void
  ignoreFolderFilter?: boolean
  onNeedCovers?: (audioUrls: string[]) => void
}

export const TrackList = memo(function TrackList({
  tracks,
  folders,
  currentTrack,
  onTrackSelect,
  onAddToQueue,
  contextLabel,
  onSelectArtist,
  isPlaying,
  selectedFolder,
  onFolderSelect,
  favorites,
  onToggleFavorite,
  ignoreFolderFilter = false,
  onNeedCovers,
}: TrackListProps) {
  const displayedTracks = useMemo(() => {
    if (ignoreFolderFilter) return tracks
    if (selectedFolder) {
      if (selectedFolder.source === "navidrome") {
        const parts = selectedFolder.id.split(":")
        const serverId = parts.length >= 2 ? parts[1] : null
        const isAllTracks = parts.length === 3 && parts[2] === "alltracks"
        if (isAllTracks && serverId) {
          const prefix = `navidrome:${serverId}:track:`
          return tracks.filter((track) => track.id.startsWith(prefix))
        }
      }
      return tracks.filter((track) => track.folderId === selectedFolder.id)
    }
    return tracks.filter((track) => !track.folderId)
  }, [ignoreFolderFilter, tracks, selectedFolder])

  const subFolders = useMemo(() => {
    if (ignoreFolderFilter) return []
    if (selectedFolder) return folders.filter((f) => f.parentId === selectedFolder.id)
    return folders.filter((f) => !f.parentId)
  }, [ignoreFolderFilter, folders, selectedFolder])

  const scrollAreaRef = useRef<any>(null)
  const viewportRef = useRef<HTMLElement | null>(null)
  const virtualContainerRef = useRef<HTMLDivElement | null>(null)
  const measureRowRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [listTop, setListTop] = useState(0)
  const [rowHeight, setRowHeight] = useState(68)

  const gap = 4
  const stride = rowHeight + gap

  useEffect(() => {
    const root = scrollAreaRef.current as HTMLElement | null
    if (!root) return
    const viewport = root.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null
    if (!viewport) return
    viewportRef.current = viewport
    setViewportHeight(viewport.clientHeight)
    setScrollTop(viewport.scrollTop)

    const onScroll = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(viewport.scrollTop)
      })
    }

    viewport.addEventListener("scroll", onScroll, { passive: true })

    const ro = new ResizeObserver(() => {
      setViewportHeight(viewport.clientHeight)
      if (virtualContainerRef.current) setListTop(virtualContainerRef.current.offsetTop)
    })
    ro.observe(viewport)

    return () => {
      viewport.removeEventListener("scroll", onScroll)
      ro.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => {
    if (virtualContainerRef.current) setListTop(virtualContainerRef.current.offsetTop)
  }, [subFolders.length, selectedFolder?.id])

  useEffect(() => {
    const el = measureRowRef.current
    if (!el) return
    const next = Math.round(el.getBoundingClientRect().height)
    if (next > 0 && next !== rowHeight) setRowHeight(next)
  }, [displayedTracks.length, rowHeight])

  useEffect(() => {
    const root = scrollAreaRef.current as HTMLElement | null
    if (!root) return
    const viewport = root.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null
    if (!viewport) return
    if (virtualContainerRef.current) setListTop(virtualContainerRef.current.offsetTop)
    setViewportHeight(viewport.clientHeight)
    setScrollTop(viewport.scrollTop)
  }, [displayedTracks.length])

  const TrackRow = ({ track, index }: { track: Track; index: number }) => {
    const isCurrentTrack = currentTrack?.id === track.id
    const displayTitle = getDisplayTitle(track.title, track.artist)
    return (
      <div
        onClick={() => onTrackSelect(track, displayedTracks, contextLabel)}
        className={cn(
          "flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors group",
          isCurrentTrack ? "bg-secondary" : "hover:bg-secondary/50",
        )}
      >
        <div className="w-8 flex items-center justify-center">
          {isCurrentTrack && isPlaying ? (
            <div className="flex items-center gap-0.5 h-4">
              <span className="w-0.5 h-full bg-foreground rounded-full animate-pulse-bar origin-bottom" />
              <span className="w-0.5 h-full bg-foreground rounded-full animate-pulse-bar-delay-1 origin-bottom" />
              <span className="w-0.5 h-full bg-foreground rounded-full animate-pulse-bar-delay-2 origin-bottom" />
            </div>
          ) : (
            <>
              <span
                className={cn(
                  "text-sm group-hover:hidden",
                  isCurrentTrack ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <Play className="w-4 h-4 hidden group-hover:block text-foreground" />
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
            <img
              src={track.coverUrl || "/placeholder.svg"}
              alt={displayTitle || "Unknown Track"}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" title={displayTitle}>
              {displayTitle}
            </p>
            <span title={track.artist} className="block truncate">
              <ArtistLinks artist={track.artist} onSelectArtist={onSelectArtist} className="truncate" />
            </span>
          </div>
        </div>

        <div className="hidden md:block w-48">
          <p className="text-sm text-muted-foreground truncate" title={track.album}>
            {track.album}
          </p>
        </div>

        <div className="w-12 text-right">
          <span className="text-sm text-muted-foreground">{formatTime(track.duration)}</span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite(track.canonicalId)
            }}
          >
            <Heart className={cn("w-4 h-4", favorites.includes(track.canonicalId) && "fill-primary text-primary")} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToQueue(track)
                }}
              >
                <ListPlus className="w-4 h-4 mr-2" />
                Add to Queue
              </DropdownMenuItem>
              {track.source === "local" && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      void invoke("show_in_explorer", { path: track.audioUrl })
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Show in Explorer
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (confirm("Are you sure you want to delete this file? This cannot be undone.")) {
                        try {
                          await invoke("delete_track", { path: track.audioUrl })
                        } catch (err) {
                          alert("Failed to delete file: " + err)
                        }
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete File
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  const count = displayedTracks.length
  const totalHeight = Math.max(0, count * stride - gap)
  const relativeTop = Math.max(0, scrollTop - listTop)
  const overscan = 8
  const startIndex = Math.max(0, Math.floor(relativeTop / stride) - overscan)
  const endIndex = Math.min(count, Math.ceil((relativeTop + viewportHeight) / stride) + overscan)

  useEffect(() => {
    if (!onNeedCovers) return
    const urls = displayedTracks
      .slice(startIndex, endIndex)
      .filter((t) => !t.coverUrl)
      .map((t) => t.audioUrl)
    if (urls.length > 0) onNeedCovers(urls)
  }, [onNeedCovers, displayedTracks, startIndex, endIndex])

  return (
    <ScrollArea className="flex-1 h-full" ref={scrollAreaRef}>
      <div className="p-6">
        <div className="mb-2">
          {selectedFolder ? (
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => {
                   if (selectedFolder.parentId) {
                       const parent = folders.find(f => f.id === selectedFolder.parentId);
                       onFolderSelect(parent || null);
                   } else {
                       onFolderSelect(null);
                   }
              }}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{selectedFolder.name}</h1>
              </div>
            </div>
          ) : (
            <div></div>
          )}
        </div>

        {subFolders.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Folders</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {subFolders.map((folder) => (
                <div
                  key={folder.id}
                  onClick={() => onFolderSelect(folder)}
                  className="group flex flex-col items-center gap-2 p-4 rounded-xl bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors"
                >
                  <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Folder className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="text-center w-full">
                    <p className="text-sm font-medium truncate">{folder.name}</p>
                    <p className="text-xs text-muted-foreground">{folder.trackCount} tracks</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {displayedTracks.length > 0 && (
            <>
             <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Tracks</h2>
             <div ref={virtualContainerRef} className="relative" style={{ height: totalHeight }}>
               <div
                 style={{ position: "absolute", top: -10000, left: 0, right: 0, visibility: "hidden" }}
                 ref={measureRowRef}
               >
                 {displayedTracks[0] ? <TrackRow track={displayedTracks[0]} index={0} /> : null}
               </div>
               {displayedTracks.slice(startIndex, endIndex).map((track, localIndex) => {
                 const index = startIndex + localIndex
                 const top = index * stride
                 return (
                   <div key={track.id} style={{ position: "absolute", top, left: 0, right: 0 }}>
                     <TrackRow track={track} index={index} />
                   </div>
                 )
               })}
             </div>
         </>
        )}

        {displayedTracks.length === 0 && subFolders.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Empty folder</p>
            </div>
        )}
      </div>
    </ScrollArea>
  )
})
