import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function getDisplayTitle(title: string, artist: string): string {
  const rawTitle = (title || "").trim()
  const rawArtist = (artist || "").trim()
  if (!rawTitle || !rawArtist) return rawTitle

  const toWordSet = (value: string) => {
    const matches = value.toLowerCase().match(/[a-z0-9]+/g)
    return new Set(matches || [])
  }

  const overlapRatio = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return 0
    let common = 0
    for (const token of a) if (b.has(token)) common += 1
    return common / Math.max(a.size, b.size)
  }

  const normalizeArtistLike = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(feat|ft|featuring|with|x)\b/g, ",")
      .replace(/[\/&]/g, ",")
      .replace(/\s*,\s*/g, ",")

  const stripArtistPrefix = (titleValue: string, artistValue: string) => {
    const separators = [" - ", " – ", " — ", " : "]
    const hit = separators
      .map((s) => ({ s, i: titleValue.indexOf(s) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i)[0]

    if (!hit) return titleValue
    const left = titleValue.slice(0, hit.i).trim()
    const right = titleValue.slice(hit.i + hit.s.length).trim()
    if (!left || !right) return titleValue

    const leftTokens = toWordSet(normalizeArtistLike(left))
    const artistTokens = toWordSet(normalizeArtistLike(artistValue))
    const looksLikeArtistList = /,|\/|&|\b(feat|ft|featuring|with|x)\b/i.test(left)
    const match = overlapRatio(leftTokens, artistTokens) >= 0.6

    if (looksLikeArtistList || match) return right
    return titleValue
  }

  return stripArtistPrefix(rawTitle, rawArtist)
}
