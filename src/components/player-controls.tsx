import type { Track, PlayerState } from "@/lib/types"
import { formatTime, cn } from "@/lib/utils"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  ListMusic,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

interface PlayerControlsProps {
  currentTrack: Track | null
  playerState: PlayerState
  onPlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onSeek: (time: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onToggleShuffle: () => void
  onToggleRepeat: () => void
}

export function PlayerControls({
  currentTrack,
  playerState,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onToggleRepeat,
}: PlayerControlsProps) {
  const VolumeIcon =
    playerState.isMuted || playerState.volume === 0 ? VolumeX : playerState.volume < 0.5 ? Volume1 : Volume2

  const RepeatIcon = playerState.repeatMode === "one" ? Repeat1 : Repeat

  return (
    <div className="h-24 bg-card/80 backdrop-blur-xl border-t border-border px-6">
      <div className="h-full flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-64 min-w-0">
          {currentTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-secondary">
                <img
                  src={currentTrack.coverUrl || "/placeholder.svg"}
                  alt={currentTrack.title || "Unknown Track"}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{currentTrack.title}</p>
                <p className="text-xs text-muted-foreground truncate">{currentTrack.artist}</p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center">
                <ListMusic className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No track selected</p>
            </div>
          )}
        </div>

        <div className="flex-1 max-w-xl">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-full", playerState.isShuffled && "text-player-accent")}
              onClick={onToggleShuffle}
            >
              <Shuffle className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={onPrevious}
              disabled={!currentTrack}
            >
              <SkipBack className="w-4 h-4" />
            </Button>

            <Button
              size="icon"
              className="h-10 w-10 rounded-full bg-foreground text-background hover:bg-foreground/90"
              onClick={onPlayPause}
              disabled={!currentTrack}
            >
              {playerState.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={onNext}
              disabled={!currentTrack}
            >
              <SkipForward className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-full", playerState.repeatMode !== "off" && "text-player-accent")}
              onClick={onToggleRepeat}
            >
              <RepeatIcon className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
              {formatTime(playerState.currentTime)}
            </span>
            <Slider
              value={[playerState.currentTime]}
              max={playerState.duration || 100}
              step={1}
              onValueChange={([value]) => onSeek(value)}
              disabled={!currentTrack}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-10 tabular-nums">{formatTime(playerState.duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-40 justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onToggleMute}>
            <VolumeIcon className="w-4 h-4" />
          </Button>
          <Slider
            value={[playerState.isMuted ? 0 : playerState.volume * 100]}
            max={100}
            step={1}
            onValueChange={([value]) => onVolumeChange(value / 100)}
            className="w-24"
          />
        </div>
      </div>
    </div>
  )
}
