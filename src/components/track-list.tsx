import { memo } from "react"
import type { Track, MusicFolder } from "@/lib/types"
import { formatTime, cn } from "@/lib/utils"
import { Play, MoreHorizontal, Heart, Folder, ChevronLeft, Trash2, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  onTrackSelect: (track: Track) => void
  isPlaying: boolean
  selectedFolder: MusicFolder | null
  onFolderSelect: (folder: MusicFolder | null) => void
  favorites: string[]
  onToggleFavorite: (trackId: string) => void
  ignoreFolderFilter?: boolean
}

export const TrackList = memo(function TrackList({
  tracks,
  folders,
  currentTrack,
  onTrackSelect,
  isPlaying,
  selectedFolder,
  onFolderSelect,
  favorites,
  onToggleFavorite,
  ignoreFolderFilter = false,
}: TrackListProps) {
  const displayedTracks = ignoreFolderFilter
    ? tracks
    : selectedFolder
      ? tracks.filter((track) => track.folderId === selectedFolder.id)
      : tracks.filter((track) => !track.folderId)
  
  const subFolders = ignoreFolderFilter
    ? []
    : selectedFolder
      ? folders.filter(f => f.parentId === selectedFolder.id)
      : folders.filter(f => !f.parentId); 
    
  return (
    <ScrollArea className="flex-1 h-full">
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
             <div className="space-y-1">
                {displayedTracks.map((track, index) => {
            const isCurrentTrack = currentTrack?.id === track.id

            return (
              <div
                key={track.id}
                onClick={() => onTrackSelect(track)}
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
                      alt={track.title || "Unknown Track"}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        isCurrentTrack ? "text-foreground" : "text-foreground",
                      )}
                    >
                      {track.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                  </div>
                </div>

                <div className="hidden md:block w-48">
                  <p className="text-sm text-muted-foreground truncate">{track.album}</p>
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
                      onToggleFavorite(track.id)
                    }}
                  >
                    <Heart className={cn("w-4 h-4", favorites.includes(track.id) && "fill-primary text-primary")} />
                  </Button>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation()
                          invoke("show_in_explorer", { path: track.audioUrl })
                      }}>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Show in Explorer
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={async (e) => {
                          e.stopPropagation()
                          if (confirm("Are you sure you want to delete this file? This cannot be undone.")) {
                              try {
                                  await invoke("delete_track", { path: track.audioUrl })
                              } catch (err) {
                                  alert("Failed to delete file: " + err)
                              }
                          }
                      }}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete File
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
