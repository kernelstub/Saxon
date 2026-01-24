import type { Track, PlayerState } from "@/lib/types"
import { formatTime, cn, getDisplayTitle } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { ArtistLinks } from "@/components/artist-links"
import {
  Music2,
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
} from "lucide-react"

interface NowPlayingProps {
  track: Track | null
  playerState: PlayerState
  onPlayPause: () => void
  onNext: () => void
  onPrevious: () => void
  onSeek: (time: number) => void
  onVolumeChange: (volume: number) => void
  onToggleMute: () => void
  onToggleShuffle: () => void
  onToggleRepeat: () => void
  onSelectArtist: (artist: string) => void
}

export function NowPlaying({
  track,
  playerState,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onToggleShuffle,
  onToggleRepeat,
  onSelectArtist,
}: NowPlayingProps) {
  const VolumeIcon =
    playerState.isMuted || playerState.volume === 0 ? VolumeX : playerState.volume < 0.5 ? Volume1 : Volume2
  const RepeatIcon = playerState.repeatMode === "one" ? Repeat1 : Repeat
  const displayTitle = track ? getDisplayTitle(track.title, track.artist) : ""

  if (!track) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-secondary flex items-center justify-center">
            <Music2 className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No track selected</h2>
          <p className="text-sm text-muted-foreground">Select a track from your library to start playing</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="relative mx-auto mb-8 w-64 h-64 md:w-72 md:h-72">
          <div
            className={cn(
              "absolute inset-0 rounded-3xl bg-muted-foreground/10 blur-3xl transition-opacity duration-500",
              playerState.isPlaying ? "opacity-60" : "opacity-30",
            )}
          />
          <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-2xl bg-secondary">
            <img
              src={track.coverUrl || "/icon.png"}
              alt={displayTitle || "Unknown Track"}
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-transform duration-700",
                playerState.isPlaying ? "scale-105" : "scale-100",
              )}
            />
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">{displayTitle}</h1>
        <ArtistLinks artist={track.artist} onSelectArtist={onSelectArtist} className="text-muted-foreground mb-1 text-sm" />
        <p className="text-sm text-muted-foreground/70 mb-8">{track.album}</p>

        <div className="space-y-2 mb-6">
          <Slider
            value={[playerState.currentTime]}
            max={playerState.duration || 100}
            step={1}
            onValueChange={([value]) => onSeek(value)}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>{formatTime(playerState.currentTime)}</span>
            <span>{formatTime(playerState.duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10 rounded-full", playerState.isShuffled && "text-foreground bg-secondary")}
            onClick={onToggleShuffle}
          >
            <Shuffle className="w-5 h-5" />
          </Button>

          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full" onClick={onPrevious}>
            <SkipBack className="w-6 h-6" />
          </Button>

          <Button
            size="icon"
            className="h-16 w-16 rounded-full bg-foreground text-background hover:bg-foreground/90"
            onClick={onPlayPause}
          >
            {playerState.isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
          </Button>

          <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full" onClick={onNext}>
            <SkipForward className="w-6 h-6" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={cn("h-10 w-10 rounded-full", playerState.repeatMode !== "off" && "text-foreground bg-secondary")}
            onClick={onToggleRepeat}
          >
            <RepeatIcon className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" onClick={onToggleMute}>
            <VolumeIcon className="w-4 h-4" />
          </Button>
          <Slider
            value={[playerState.isMuted ? 0 : playerState.volume * 100]}
            max={100}
            step={1}
            onValueChange={([value]) => onVolumeChange(value / 100)}
            className="w-32"
          />
        </div>
      </div>
    </div>
  )
}
