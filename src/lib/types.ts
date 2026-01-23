export interface Track {
  id: string
  canonicalId: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string | null
  audioUrl: string
  folderId: string | null
  source: "local" | "navidrome"
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
  source: "local" | "navidrome"
}

export interface NavidromeServerConfig {
  id: string
  name: string
  baseUrl: string
  username: string
  token: string
  salt: string
  apiKey?: string | null
  enabled: boolean
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
  showWindowControls?: boolean
  useNativeTitlebar?: boolean
  selectedTheme?: string
  discordRichPresence?: boolean
  navidromeServers?: NavidromeServerConfig[]
}
