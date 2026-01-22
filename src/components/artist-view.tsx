"use client"

import { memo, useMemo } from "react"
import type { Track, MusicFolder } from "@/lib/types"
import { TrackList } from "@/components/track-list"
import { matchArtist } from "@/components/artist-links"

interface ArtistViewProps {
  artist: string
  tracks: Track[]
  currentTrack: Track | null
  isPlaying: boolean
  onTrackSelect: (track: Track, contextTracks: Track[], contextLabel: string) => void
  onAddToQueue: (track: Track) => void
  onBack: () => void
  onSelectArtist: (artist: string) => void
  favorites: string[]
  onToggleFavorite: (trackId: string) => void
  onNeedCovers?: (audioUrls: string[]) => void
}

export const ArtistView = memo(function ArtistView({
  artist,
  tracks,
  currentTrack,
  isPlaying,
  onTrackSelect,
  onAddToQueue,
  onBack,
  onSelectArtist,
  favorites,
  onToggleFavorite,
  onNeedCovers,
}: ArtistViewProps) {
  const artistTracks = useMemo(() => tracks.filter((t) => matchArtist(t.artist, artist)), [tracks, artist])

  const dummyFolder: MusicFolder = useMemo(
    () => ({
      id: `artist:${artist}`,
      parentId: "artist:root",
      name: artist,
      path: artist,
      trackCount: artistTracks.length,
      source: "local",
    }),
    [artist, artistTracks.length],
  )

  return (
    <TrackList
      tracks={artistTracks}
      folders={[]}
      currentTrack={currentTrack}
      onTrackSelect={onTrackSelect}
      onAddToQueue={onAddToQueue}
      contextLabel={artist}
      isPlaying={isPlaying}
      selectedFolder={dummyFolder}
      onFolderSelect={() => onBack()}
      favorites={favorites}
      onToggleFavorite={onToggleFavorite}
      ignoreFolderFilter
      onNeedCovers={onNeedCovers}
      onSelectArtist={onSelectArtist}
    />
  )
})

