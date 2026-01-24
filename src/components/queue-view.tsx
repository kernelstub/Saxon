"use client"

import { memo, useEffect } from "react"
import type { Track } from "@/lib/types"
import { formatTime, cn, getDisplayTitle } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ListMusic, X } from "lucide-react"
import { ArtistLinks } from "@/components/artist-links"

interface QueueViewProps {
  currentTrack: Track | null
  manualQueue: Track[]
  contextQueue: Track[]
  contextLabel: string
  onPlayTrack: (track: Track) => void
  onRemoveManualQueueIndex: (index: number) => void
  onRemoveFromContextQueue: (trackId: string) => void
  onSelectArtist: (artist: string) => void
  onNeedCovers?: (audioUrls: string[]) => void
}

export const QueueView = memo(function QueueView({
  currentTrack,
  manualQueue,
  contextQueue,
  contextLabel,
  onPlayTrack,
  onRemoveManualQueueIndex,
  onRemoveFromContextQueue,
  onSelectArtist,
  onNeedCovers,
}: QueueViewProps) {
  if (!currentTrack) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-secondary flex items-center justify-center">
            <ListMusic className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Queue is empty</h2>
          <p className="text-sm text-muted-foreground">Play a track to start building your queue</p>
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (!onNeedCovers) return
    const audioUrls = [currentTrack, ...manualQueue, ...contextQueue]
      .filter((t) => !t.coverUrl)
      .map((t) => t.audioUrl)
      .filter(Boolean)
    if (audioUrls.length > 0) onNeedCovers(audioUrls)
  }, [onNeedCovers, currentTrack, manualQueue, contextQueue])

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">{manualQueue.length + contextQueue.length} tracks up next</p>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Now Playing</h2>
            <div
              onClick={() => onPlayTrack(currentTrack)}
              className={cn(
                "grid grid-cols-[2rem_minmax(0,1fr)_3rem_2.5rem] md:grid-cols-[2rem_minmax(0,1fr)_12rem_3rem_2.5rem] items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors hover:bg-secondary/40",
              )}
            >
              <div className="w-8 flex items-center justify-center text-sm text-muted-foreground tabular-nums">
                1
              </div>

              <div className="flex items-center gap-3 min-w-0 overflow-hidden">
                <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
                  <img
                    src={currentTrack.coverUrl || "/icon.png"}
                    alt={getDisplayTitle(currentTrack.title, currentTrack.artist) || "Unknown Track"}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 overflow-hidden">
                  <p
                    className="text-sm font-medium truncate"
                    title={getDisplayTitle(currentTrack.title, currentTrack.artist)}
                  >
                    {getDisplayTitle(currentTrack.title, currentTrack.artist)}
                  </p>
                  <span title={currentTrack.artist} className="block truncate">
                    <ArtistLinks artist={currentTrack.artist} onSelectArtist={onSelectArtist} className="truncate" />
                  </span>
                </div>
              </div>

              <div className="hidden md:block min-w-0">
                <p className="text-sm text-muted-foreground truncate" title={currentTrack.album}>
                  {currentTrack.album}
                </p>
              </div>

              <div className="w-12 text-right tabular-nums">
                <span className="text-sm text-muted-foreground">{formatTime(currentTrack.duration)}</span>
              </div>

              <div className="w-10" />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Next in Queue</h2>
            {manualQueue.map((track, index) => (
              <div
                key={`${track.id}:${index}`}
                onClick={() => onPlayTrack(track)}
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)_3rem_2.5rem] md:grid-cols-[2rem_minmax(0,1fr)_12rem_3rem_2.5rem] items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors group hover:bg-secondary/40",
                )}
              >
                <div className="w-8 flex items-center justify-center text-sm text-muted-foreground tabular-nums">
                  {index + 1}
                </div>

                <div className="flex items-center gap-3 min-w-0 overflow-hidden">
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
                    <img
                      src={track.coverUrl || "/icon.png"}
                      alt={getDisplayTitle(track.title, track.artist) || "Unknown Track"}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-sm font-medium truncate" title={getDisplayTitle(track.title, track.artist)}>
                      {getDisplayTitle(track.title, track.artist)}
                    </p>
                    <span title={track.artist} className="block truncate">
                      <ArtistLinks artist={track.artist} onSelectArtist={onSelectArtist} className="truncate" />
                    </span>
                  </div>
                </div>

                <div className="hidden md:block min-w-0">
                  <p className="text-sm text-muted-foreground truncate" title={track.album}>
                    {track.album}
                  </p>
                </div>

                <div className="w-12 text-right tabular-nums">
                  <span className="text-sm text-muted-foreground">{formatTime(track.duration)}</span>
                </div>

                <div className="w-10 flex justify-end items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRemoveManualQueueIndex(index)
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            {manualQueue.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <p>Nothing in your queue</p>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Next From {contextLabel}</h2>
            {contextQueue.map((track, index) => (
              <div
                key={track.id}
                onClick={() => onPlayTrack(track)}
                className={cn(
                  "grid grid-cols-[2rem_minmax(0,1fr)_3rem_2.5rem] md:grid-cols-[2rem_minmax(0,1fr)_12rem_3rem_2.5rem] items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors group hover:bg-secondary/40",
                )}
              >
                <div className="w-8 flex items-center justify-center text-sm text-muted-foreground tabular-nums">
                  {index + 1}
                </div>

                <div className="flex items-center gap-3 min-w-0 overflow-hidden">
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
                    <img
                      src={track.coverUrl || "/icon.png"}
                      alt={getDisplayTitle(track.title, track.artist) || "Unknown Track"}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-sm font-medium truncate" title={getDisplayTitle(track.title, track.artist)}>
                      {getDisplayTitle(track.title, track.artist)}
                    </p>
                    <span title={track.artist} className="block truncate">
                      <ArtistLinks artist={track.artist} onSelectArtist={onSelectArtist} className="truncate" />
                    </span>
                  </div>
                </div>

                <div className="hidden md:block min-w-0">
                  <p className="text-sm text-muted-foreground truncate" title={track.album}>
                    {track.album}
                  </p>
                </div>

                <div className="w-12 text-right tabular-nums">
                  <span className="text-sm text-muted-foreground">{formatTime(track.duration)}</span>
                </div>

                <div className="w-10 flex justify-end items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRemoveFromContextQueue(track.id)
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}

            {contextQueue.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <p>Nothing coming from {contextLabel}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
})
