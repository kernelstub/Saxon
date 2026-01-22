"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"

const splitArtists = (input: string) => {
  return input
    .split(/[\/,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

interface ArtistLinksProps {
  artist: string
  onSelectArtist: (artist: string) => void
  className?: string
}

export const ArtistLinks = memo(function ArtistLinks({ artist, onSelectArtist, className }: ArtistLinksProps) {
  const artists = splitArtists(artist)
  if (artists.length <= 1) {
    return (
      <button
        className={cn("text-xs text-muted-foreground hover:underline", className)}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (artists[0]) onSelectArtist(artists[0])
        }}
      >
        {artists[0] || artist}
      </button>
    )
  }

  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {artists.map((name, index) => (
        <span key={`${name}:${index}`}>
          <button
            className="hover:underline"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSelectArtist(name)
            }}
          >
            {name}
          </button>
          {index < artists.length - 1 ? ", " : null}
        </span>
      ))}
    </span>
  )
})

export const matchArtist = (trackArtist: string, selected: string) => {
  const target = selected.trim().toLowerCase()
  return splitArtists(trackArtist).some((a) => a.toLowerCase() === target)
}
