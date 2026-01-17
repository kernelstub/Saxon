export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string | null
  audioUrl: string
  folderId: string | null
}

export interface PlayerState {
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isShuffled: boolean
  repeatMode: "off" | "all" | "one"
}

export interface MusicFolder {
  id: string
  parentId: string | null
  name: string
  path: string
  trackCount: number
}

export interface AppConfig {
  musicFolders: string[]
  favorites: string[]
  recentTracks: string[]
  eqEnabled?: boolean
  eqPreset?: string
  eqValues?: number[]
  crossfade?: number
  normalize?: boolean
}
