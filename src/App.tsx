import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TrackList } from "@/components/track-list";
import { NowPlaying } from "@/components/now-playing";
import { QueueView } from "@/components/queue-view";
import { ArtistView } from "@/components/artist-view";
import { PlayerControls } from "@/components/player-controls";
import { SettingsPanel } from "@/components/settings-panel";
import type { Track, PlayerState, MusicFolder, AppConfig } from "@/lib/types";
import { applyThemeMap } from "@/lib/theme"
import { getDisplayTitle } from "@/lib/utils"
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

interface ScanResult {
  tracks: Track[];
  folders: MusicFolder[];
  revision: string;
}

function App() {
  const [view, setView] = useState<"library" | "nowplaying" | "queue" | "artist" | "favorites" | "recent">("library");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<MusicFolder | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
  const lastNonArtistViewRef = useRef<"library" | "nowplaying" | "queue" | "favorites" | "recent">("library")
  const [showWindowControls, setShowWindowControls] = useState(false)
  const [useNativeTitlebar, setUseNativeTitlebar] = useState(false)
  const appliedThemeVarsRef = useRef<Set<string>>(new Set())
  const [selectedTheme, setSelectedTheme] = useState("default")
  const selectedThemeRef = useRef("default")
  const [themeOptions, setThemeOptions] = useState<string[]>([])
  const themeMapsRef = useRef<Record<string, Record<string, string>>>({})
  const [discordRichPresence, setDiscordRichPresence] = useState(false)
  const [discordRpcError, setDiscordRpcError] = useState<string | null>(null)
  const [discordRpcTestSuccessAt, setDiscordRpcTestSuccessAt] = useState<number | null>(null)

  const [folders, setFolders] = useState<MusicFolder[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recentTracks, setRecentTracks] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [eqEnabled, setEqEnabled] = useState(true)
  const [eqPreset, setEqPreset] = useState("flat")
  const [eqValues, setEqValues] = useState<number[]>([50, 50, 50, 50, 50, 50, 50, 50, 50, 50])
  const [crossfade, setCrossfade] = useState(0)
  const [normalize, setNormalize] = useState(false)
  const eqPresetRef = useRef(eqPreset)
  const crossfadeTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const eqFiltersRef = useRef<BiquadFilterNode[]>([])
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const webAudioActiveRef = useRef(false)

  const [playerState, setPlayerState] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    isMuted: false,
    isShuffled: false,
    repeatMode: "off",
  });

  const playerStateRef = useRef(playerState)
  const tracksRef = useRef<Track[]>([])
  const currentTrackRef = useRef<Track | null>(null)
  const playbackHistoryRef = useRef<string[]>([])
  const playTrackRef = useRef<((track: Track, useCrossfade: boolean) => void) | null>(null)

  const trackByIdRef = useRef<Map<string, Track>>(new Map())
  const playbackListIdsRef = useRef<string[]>([])
  const shuffleOrderIdsRef = useRef<string[] | null>(null)
  const shuffleNonceRef = useRef(0)
  const [manualQueueIds, setManualQueueIds] = useState<string[]>([])
  const manualQueueIdsRef = useRef<string[]>([])
  const [queueRemovedIds, setQueueRemovedIds] = useState<string[]>([])
  const queueRemovedSetRef = useRef<Set<string>>(new Set())
  const [contextLabel, setContextLabel] = useState("Library")

  useEffect(() => {
    playerStateRef.current = playerState
  }, [playerState])

  useEffect(() => {
    tracksRef.current = tracks
    trackByIdRef.current = new Map(tracks.map((t) => [t.id, t]))
  }, [tracks])

  useEffect(() => {
    queueRemovedSetRef.current = new Set(queueRemovedIds)
  }, [queueRemovedIds])

  useEffect(() => {
    manualQueueIdsRef.current = manualQueueIds
  }, [manualQueueIds])

  useEffect(() => {
    currentTrackRef.current = currentTrack
  }, [currentTrack])

  useEffect(() => {
    const send = async () => {
      const track = currentTrackRef.current
      const ps = playerStateRef.current

      if (!discordRichPresence || !track) {
        await invoke("discord_rpc_clear").catch(() => {})
        return
      }

      const durationSeconds = ps.duration > 0 ? ps.duration : track.duration || 0
      const durationMs = Math.max(0, Math.round(durationSeconds * 1000))
      const positionMs = Math.max(0, Math.round((ps.currentTime || 0) * 1000))
      const coverUrl =
        track.coverUrl && (track.coverUrl.startsWith("http://") || track.coverUrl.startsWith("https://"))
          ? track.coverUrl
          : undefined
      const rawArtist = (track.artist || "").trim()
      const rpcArtist = rawArtist
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ")
      const title = getDisplayTitle(track.title, track.artist)

      await invoke("discord_rpc_set_activity", {
        title: title || "Unknown Title",
        artist: rpcArtist || "Unknown Artist",
        album: track.album || "",
        durationMs,
        positionMs,
        isPlaying: ps.isPlaying,
        coverUrl,
      })
        .then(() => setDiscordRpcError(null))
        .catch((e) => setDiscordRpcError(typeof e === "string" ? e : "Discord Rich Presence failed"))
    }

    send()

    if (!discordRichPresence || !playerState.isPlaying) return
    const id = window.setInterval(send, 15_000)
    return () => window.clearInterval(id)
  }, [discordRichPresence, currentTrack?.id, playerState.isPlaying])

  useEffect(() => {
    if (view !== "artist") lastNonArtistViewRef.current = view
  }, [view])

  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const audioPathRef = useRef<string | null>(null);
  const coverCacheRef = useRef<Map<string, string>>(new Map())
  const coverInFlightRef = useRef<Set<string>>(new Set())
  const refreshInFlightRef = useRef(false)
  const libraryRevisionRef = useRef<string | null>(null)
  const navidromeCacheRef = useRef<{ tracks: Track[]; folders: MusicFolder[]; revisions: string[]; serverKey: string } | null>(null)
  const navidromeLastRefreshRef = useRef(0)
  const navidromeRefreshInFlightRef = useRef(false)

  const applyCachedCovers = useCallback((nextTracks: Track[]) => {
    const coverCache = coverCacheRef.current
    return nextTracks.map((t) => {
      const cached = coverCache.get(t.audioUrl)
      return cached ? { ...t, coverUrl: cached } : t
    })
  }, [])

  const ensureCoverForAudioUrl = useCallback(async (audioUrl: string) => {
    if (audioUrl.startsWith("http://") || audioUrl.startsWith("https://")) return
    const coverCache = coverCacheRef.current
    if (coverCache.has(audioUrl)) return
    if (coverInFlightRef.current.has(audioUrl)) return
    coverInFlightRef.current.add(audioUrl)
    try {
      const coverUrl = await invoke<string | null>("cover_server_register", { path: audioUrl })
      if (!coverUrl) return
      coverCache.set(audioUrl, coverUrl)
      setTracks((prev) => prev.map((t) => (t.audioUrl === audioUrl ? { ...t, coverUrl } : t)))
      setCurrentTrack((prev) => (prev && prev.audioUrl === audioUrl ? { ...prev, coverUrl } : prev))
    } catch {}
    finally {
      coverInFlightRef.current.delete(audioUrl)
    }
  }, [])

  const ensureCoversForAudioUrls = useCallback((audioUrls: string[]) => {
    for (const url of audioUrls) void ensureCoverForAudioUrl(url)
  }, [ensureCoverForAudioUrl])

  const ensureAudioGraph = useCallback(async () => {
    const audio = audioRef.current
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext

    if (!eqEnabled && !normalize) {
      webAudioActiveRef.current = false
      return
    }

    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextCtor()
      mediaSourceRef.current = null
      eqFiltersRef.current = []
      compressorRef.current = null
      masterGainRef.current = null
      webAudioActiveRef.current = false
    }

    const ctx = audioContextRef.current

    if (ctx.state === "suspended") {
      try {
        await ctx.resume()
      } catch {}
    }

    if (ctx.state !== "running") {
      webAudioActiveRef.current = false
      return
    }

    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain()
      masterGainRef.current.gain.value = 1
    }

    if (!compressorRef.current) {
      compressorRef.current = ctx.createDynamicsCompressor()
    }

    if (eqFiltersRef.current.length !== 10) {
      const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
      eqFiltersRef.current = freqs.map((f) => {
        const filter = ctx.createBiquadFilter()
        filter.type = "peaking"
        filter.frequency.value = f
        filter.Q.value = 1
        filter.gain.value = 0
        return filter
      })
    }

    if (!mediaSourceRef.current) {
      mediaSourceRef.current = ctx.createMediaElementSource(audio)
    }

    try {
      mediaSourceRef.current.disconnect()
    } catch {}
    for (const node of eqFiltersRef.current) {
      try {
        node.disconnect()
      } catch {}
    }
    try {
      compressorRef.current.disconnect()
    } catch {}
    try {
      masterGainRef.current.disconnect()
    } catch {}

    const filters = eqFiltersRef.current
    const compressor = compressorRef.current
    const master = masterGainRef.current

    mediaSourceRef.current.connect(filters[0])
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1])
    }
    filters[filters.length - 1].connect(compressor)
    compressor.connect(master)
    master.connect(ctx.destination)
    webAudioActiveRef.current = true
    audio.muted = false
    audio.volume = 1
  }, [eqEnabled, normalize])

  useEffect(() => {
    eqPresetRef.current = eqPreset
  }, [eqPreset])

  useEffect(() => {
    selectedThemeRef.current = selectedTheme
  }, [selectedTheme])

  useEffect(() => {
    const init = async () => {
      try {
        const prunedPaths = await invoke<string[]>("prune_music_folders");
        const config = await invoke<AppConfig>("load_config");
        
        setFavorites(new Set(config.favorites || []));
        setRecentTracks(config.recentTracks || []);
        
        if (config.eqEnabled !== undefined) setEqEnabled(config.eqEnabled);
        if (config.eqPreset) setEqPreset(config.eqPreset);
        if (config.eqValues && config.eqValues.length === 10) setEqValues(config.eqValues);
        if (config.crossfade !== undefined) setCrossfade(config.crossfade);
        if (config.normalize !== undefined) setNormalize(config.normalize);
        if (config.showWindowControls !== undefined) setShowWindowControls(config.showWindowControls)
        if (config.useNativeTitlebar !== undefined) {
          setUseNativeTitlebar(config.useNativeTitlebar)
          if (config.useNativeTitlebar) {
            invoke("set_window_decorations", { enabled: true }).catch(() => {})
          }
        }
        if (config.selectedTheme) setSelectedTheme(config.selectedTheme)
        if (config.discordRichPresence !== undefined) setDiscordRichPresence(config.discordRichPresence)

        try {
          const themeName = config.selectedTheme || "default"
          const result = await invoke<{ themes: Record<string, Record<string, string>>; order: string[] }>("load_color_themes")
          themeMapsRef.current = result.themes || {}
          const options = result.order && result.order.length > 0 ? result.order : Object.keys(result.themes || {})
          setThemeOptions(options)
          const effective =
            (result.themes && result.themes[themeName] ? themeName : result.themes && result.themes["default"] ? "default" : options[0]) ||
            "default"
          setSelectedTheme(effective)
          applyThemeMap((result.themes && result.themes[effective]) || {}, appliedThemeVarsRef.current)
        } catch {}

        const localResults = prunedPaths.length > 0
          ? await Promise.all(prunedPaths.map((path) => invoke<ScanResult>("scan_music_library", { path })))
          : []

        const enabledServers = (config.navidromeServers || []).filter((s) => s.enabled)
        const serverKey = enabledServers.map((s) => s.id).sort().join("|")
        const navidromeResults = enabledServers.length > 0
          ? await Promise.all(enabledServers.map((s) => invoke<ScanResult>("navidrome_scan_library", { serverId: s.id })))
          : []

        navidromeCacheRef.current = {
          tracks: navidromeResults.flatMap((r) => r.tracks),
          folders: navidromeResults.flatMap((r) => r.folders),
          revisions: navidromeResults.map((r) => r.revision),
          serverKey,
        }
        navidromeLastRefreshRef.current = Date.now()

        const results = [...localResults, ...navidromeResults]
        if (results.length > 0) {
          const tracksById = new Map<string, Track>();
          const foldersByPath = new Map<string, MusicFolder>();

          results.forEach((result) => {
            result.tracks.forEach((t) => tracksById.set(t.id, t));
            result.folders.forEach((f) => foldersByPath.set(f.path, f));
          });

          const combinedRevision = results.map((r) => r.revision).join("|")
          libraryRevisionRef.current = combinedRevision

          const nextTracks = applyCachedCovers(Array.from(tracksById.values()))
          const nextFolders = Array.from(foldersByPath.values())
          startTransition(() => {
            setTracks(nextTracks)
            setFolders(nextFolders)
          })
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      }
    };

    init();
  }, []);

  useEffect(() => {
    const refreshLibrary = async () => {
      if (document.hidden) return
      if (refreshInFlightRef.current) return
      refreshInFlightRef.current = true
      try {
        try {
          const themeName = selectedThemeRef.current || "default"
          const result = await invoke<{ themes: Record<string, Record<string, string>>; order: string[] }>("load_color_themes")
          themeMapsRef.current = result.themes || {}
          const options = result.order && result.order.length > 0 ? result.order : Object.keys(result.themes || {})
          if (options.length > 0) setThemeOptions(options)
          const effective =
            (result.themes && result.themes[themeName] ? themeName : result.themes && result.themes["default"] ? "default" : options[0]) ||
            "default"
          if (effective !== selectedThemeRef.current) setSelectedTheme(effective)
          applyThemeMap((result.themes && result.themes[effective]) || {}, appliedThemeVarsRef.current)
        } catch {}

        const config = await invoke<AppConfig>("load_config");
        const folders = config.musicFolders || [];
        const enabledServers = (config.navidromeServers || []).filter((s) => s.enabled)
        const serverKey = enabledServers.map((s) => s.id).sort().join("|")

        const shouldRefreshNavidrome =
          enabledServers.length > 0 &&
          (!navidromeCacheRef.current ||
            navidromeCacheRef.current.serverKey !== serverKey ||
            Date.now() - navidromeLastRefreshRef.current > 60_000)
        
        const localResults = folders.length > 0
          ? await Promise.all(folders.map((path) => invoke<ScanResult>("scan_music_library", { path })))
          : []

        if (shouldRefreshNavidrome && !navidromeRefreshInFlightRef.current) {
          navidromeRefreshInFlightRef.current = true
          try {
            const navidromeResults = await Promise.all(
              enabledServers.map((s) => invoke<ScanResult>("navidrome_scan_library", { serverId: s.id })),
            )
            navidromeCacheRef.current = {
              tracks: navidromeResults.flatMap((r) => r.tracks),
              folders: navidromeResults.flatMap((r) => r.folders),
              revisions: navidromeResults.map((r) => r.revision),
              serverKey,
            }
            navidromeLastRefreshRef.current = Date.now()
          } finally {
            navidromeRefreshInFlightRef.current = false
          }
        } else if (navidromeCacheRef.current && navidromeCacheRef.current.serverKey !== serverKey) {
          navidromeCacheRef.current = { tracks: [], folders: [], revisions: [], serverKey }
        }

        const cachedNav = navidromeCacheRef.current
        const navidromeResultsForRevision = cachedNav ? cachedNav.revisions : []

        const combinedRevision = [...localResults.map((r) => r.revision), ...navidromeResultsForRevision].join("|")
        if (libraryRevisionRef.current === combinedRevision) return
        libraryRevisionRef.current = combinedRevision

        const tracksById = new Map<string, Track>();
        const foldersByPath = new Map<string, MusicFolder>();

        localResults.forEach((result) => {
          result.tracks.forEach((t) => tracksById.set(t.id, t));
          result.folders.forEach((f) => foldersByPath.set(f.path, f));
        });
        if (cachedNav) {
          cachedNav.tracks.forEach((t) => tracksById.set(t.id, t))
          cachedNav.folders.forEach((f) => foldersByPath.set(f.path, f))
        }

        const nextTracks = applyCachedCovers(Array.from(tracksById.values()))
        const nextFolders = Array.from(foldersByPath.values())
        startTransition(() => {
          setTracks(nextTracks)
          setFolders(nextFolders)
        })
      } catch (error) {
        console.error("Failed to refresh library:", error);
      } finally {
        refreshInFlightRef.current = false
      }
    };

    const interval = setInterval(refreshLibrary, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveEqSettings = useCallback((enabled: boolean, preset: string, values: number[], cf: number, norm: boolean) => {
    setEqEnabled(enabled);
    setEqPreset(preset);
    setEqValues(values);
    setCrossfade(cf);
    setNormalize(norm);
    
    invoke("load_config").then((c: any) => {
        invoke("save_config", { config: { 
            ...c, 
            eqEnabled: enabled,
            eqPreset: preset,
            eqValues: values,
            crossfade: cf,
            normalize: norm
        }});
    });
  }, []);

  const handleSaveWindowControls = useCallback((enabled: boolean) => {
    setShowWindowControls(enabled)
    invoke("load_config").then((c: any) => {
      invoke("save_config", { config: { ...c, showWindowControls: enabled } })
    })
  }, [])

  const handleSaveUseNativeTitlebar = useCallback((enabled: boolean) => {
    setUseNativeTitlebar(enabled)
    invoke("set_window_decorations", { enabled }).catch(() => {})
    invoke("load_config").then((c: any) => {
      invoke("save_config", { config: { ...c, useNativeTitlebar: enabled } })
    })
  }, [])

  const handleSaveSelectedTheme = useCallback((themeName: string) => {
    const themes = themeMapsRef.current
    const options = themeOptions
    const effective =
      themes[themeName] ? themeName : themes["default"] ? "default" : options[0] ? options[0] : Object.keys(themes)[0]

    if (effective) {
      setSelectedTheme(effective)
      applyThemeMap(themes[effective] || {}, appliedThemeVarsRef.current)
      invoke("load_config").then((c: any) => {
        invoke("save_config", { config: { ...c, selectedTheme: effective } })
      })
    }
  }, [themeOptions])

  const handleSaveDiscordRichPresence = useCallback((enabled: boolean) => {
    setDiscordRichPresence(enabled)
    if (!enabled) {
      setDiscordRpcError(null)
      setDiscordRpcTestSuccessAt(null)
      invoke("discord_rpc_clear").catch(() => {})
    } else {
      invoke("discord_rpc_connect")
        .then(() => setDiscordRpcError(null))
        .catch((e) => setDiscordRpcError(typeof e === "string" ? e : "Failed to connect to Discord"))
    }
    invoke("load_config").then((c: any) => {
      invoke("save_config", { config: { ...c, discordRichPresence: enabled } })
    })
  }, [])

  const handleTestDiscordRichPresence = useCallback(() => {
    invoke("discord_rpc_connect")
      .then(() =>
        invoke("discord_rpc_set_activity", {
          title: "Saxon",
          artist: "Rich Presence Test",
          album: "",
          durationMs: 0,
          positionMs: 0,
          isPlaying: true,
        })
      )
      .then(() => {
        setDiscordRpcError(null)
        setDiscordRpcTestSuccessAt(Date.now())
      })
      .catch((e) => setDiscordRpcError(typeof e === "string" ? e : "Discord Rich Presence test failed"))
  }, [])


  useEffect(() => {
    if (eqFiltersRef.current.length === 10) {
      eqFiltersRef.current.forEach((filter, index) => {
        const val = eqValues[index]
        const gain = ((val - 50) / 50) * 12
        filter.gain.value = eqEnabled ? gain : 0
      })
    }

    if (compressorRef.current) {
      if (normalize) {
        compressorRef.current.threshold.value = -24
        compressorRef.current.ratio.value = 12
      } else {
        compressorRef.current.threshold.value = 0
        compressorRef.current.ratio.value = 1
      }
    }
  }, [eqValues, eqEnabled, normalize])

  const startPlayback = async (track: Track) => {
    const audio = audioRef.current

    try {
      await ensureAudioGraph()

      if (audioPathRef.current !== track.audioUrl) {
        audio.pause()
        audio.currentTime = 0

        if (track.source === "navidrome") {
          audio.crossOrigin = "anonymous"
          audio.src = track.audioUrl
        } else {
          audio.crossOrigin = ""
          audio.src = convertFileSrc(track.audioUrl)
        }

        audioPathRef.current = track.audioUrl
        audio.load()
      }

      audio.muted = false

      if (eqFiltersRef.current.length === 10) {
        eqFiltersRef.current.forEach((filter, index) => {
          const val = eqValues[index]
          const gain = ((val - 50) / 50) * 12
          filter.gain.value = eqEnabled ? gain : 0
        })
      }

      if (compressorRef.current) {
        if (normalize) {
          compressorRef.current.threshold.value = -24
          compressorRef.current.ratio.value = 12
        } else {
          compressorRef.current.threshold.value = 0
          compressorRef.current.ratio.value = 1
        }
      }
      
      if (!webAudioActiveRef.current) {
        audio.volume = playerState.isMuted ? 0 : playerState.volume
        audio.muted = false
      } else if (masterGainRef.current) {
        masterGainRef.current.gain.value = playerState.isMuted ? 0 : playerState.volume
      }

      await audio.play();
    } catch (e) {
      console.error("Playback failed:", e);
      setPlayerState((prev) => ({ ...prev, isPlaying: false }));
    }
  };

  useEffect(() => {
    const audio = audioRef.current
    if (webAudioActiveRef.current && masterGainRef.current) {
      masterGainRef.current.gain.value = playerState.isMuted ? 0 : playerState.volume
      audio.muted = false
      audio.volume = 1
    } else {
      audio.volume = playerState.isMuted ? 0 : playerState.volume
      audio.muted = false
    }
  }, [playerState.volume, playerState.isMuted]);

  const handlePlayPause = async () => {
    if (!currentTrack) return;
    const audio = audioRef.current;

    if (playerState.isPlaying) {
      audio.pause();
      setPlayerState((prev) => ({ ...prev, isPlaying: false }));
      return;
    }

    await startPlayback(currentTrack);
    setPlayerState((prev) => ({ ...prev, isPlaying: !audio.paused }));
  };

  const addToRecent = useCallback((trackId: string) => {
    setRecentTracks(prev => {
        const next = [trackId, ...prev.filter(id => id !== trackId)].slice(0, 50);
        
        invoke("load_config").then((c: any) => {
            invoke("save_config", { config: { ...c, recentTracks: next } });
        });
        
        return next;
    });
  }, []);

  const playTrack = useCallback((track: Track, useCrossfade: boolean) => {
    if (crossfadeTimerRef.current !== null) {
      clearInterval(crossfadeTimerRef.current)
      crossfadeTimerRef.current = null
    }

    const playNext = () => {
        const prev = currentTrackRef.current
        if (prev && prev.id !== track.id) {
          playbackHistoryRef.current = [...playbackHistoryRef.current, prev.id].slice(-100)
        }
        currentTrackRef.current = track
        setCurrentTrack(track);
        void ensureCoverForAudioUrl(track.audioUrl)
        setPlayerState((prev) => ({
          ...prev,
          isPlaying: true,
          currentTime: 0,
          duration: track.duration,
        }));
        addToRecent(track.canonicalId);
        void startPlayback(track);
    };

    if (useCrossfade && crossfade > 0 && playerState.isPlaying && audioRef.current) {
        const audio = audioRef.current;
        const originalVolume = playerState.isMuted ? 0 : playerState.volume;
        const fadeStep = originalVolume / 10;
        const fadeInterval = (crossfade * 1000) / 10;
        
        let vol = originalVolume;
        const fadeOut = window.setInterval(() => {
            vol -= fadeStep;
            if (vol <= 0) {
                clearInterval(fadeOut);
                crossfadeTimerRef.current = null
                if (masterGainRef.current) masterGainRef.current.gain.value = 0
                else audio.volume = 0
                
                playNext();
                
                setTimeout(() => {
                     if (masterGainRef.current) masterGainRef.current.gain.value = originalVolume
                     else audio.volume = originalVolume
                }, 50);
            } else {
                if (masterGainRef.current) masterGainRef.current.gain.value = vol
                else audio.volume = vol
            }
        }, fadeInterval);
        crossfadeTimerRef.current = fadeOut
    } else {
        if (masterGainRef.current) masterGainRef.current.gain.value = playerState.isMuted ? 0 : playerState.volume
        else if (audioRef.current) audioRef.current.volume = playerState.volume;
        playNext();
    }
  }, [addToRecent, crossfade, playerState.isPlaying, playerState.volume, playerState.isMuted, ensureCoverForAudioUrl]);

  useEffect(() => {
    playTrackRef.current = playTrack
  }, [playTrack])

  useEffect(() => {
    if (!currentTrack) return
    const match =
      tracks.find((t) => t.id === currentTrack.id) ??
      tracks.find((t) => t.audioUrl === currentTrack.audioUrl)
    if (match && match !== currentTrack) setCurrentTrack(match)
  }, [tracks, currentTrack])

  const hashString = (input: string) => {
    let h = 2166136261
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  const mulberry32 = (seed: number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const arraysEqual = (a: string[], b: string[]) => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  const setPlaybackContext = useCallback((contextTracks: Track[], nextLabel: string) => {
    const nextIds = contextTracks.map((t) => t.id)
    const changed = !arraysEqual(nextIds, playbackListIdsRef.current)
    playbackListIdsRef.current = nextIds
    if (changed) {
      setQueueRemovedIds([])
      setContextLabel(nextLabel)
    }
  }, [])

  const handleTrackSelect = useCallback((track: Track, contextTracks: Track[], nextLabel: string) => {
    setPlaybackContext(contextTracks, nextLabel)
    if (playerStateRef.current.isShuffled) {
      shuffleNonceRef.current += 1
      shuffleOrderIdsRef.current = null
    }
    playTrack(track, false);
  }, [playTrack, setPlaybackContext]);

  const ensureShuffleOrder = useCallback(() => {
    if (!playerStateRef.current.isShuffled) {
      shuffleOrderIdsRef.current = null
      return
    }
    if (shuffleOrderIdsRef.current && shuffleOrderIdsRef.current.length > 0) return

    const listIds = playbackListIdsRef.current.length > 0
      ? playbackListIdsRef.current
      : tracksRef.current.map((t) => t.id)
    const current = currentTrackRef.current
    const currentId = current?.id
    const currentIndex = currentId ? listIds.indexOf(currentId) : -1
    const headId = currentIndex >= 0 ? listIds[currentIndex] : listIds[0]

    const remaining = listIds.filter((id) => id !== headId)
    const seed = hashString(`${shuffleNonceRef.current}|${headId}|${listIds.length}`)
    const rnd = mulberry32(seed)
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const tmp = remaining[i]
      remaining[i] = remaining[j]
      remaining[j] = tmp
    }
    shuffleOrderIdsRef.current = [headId, ...remaining]
  }, [])

  const getSequenceIds = useCallback(() => {
    if (playerStateRef.current.isShuffled) {
      ensureShuffleOrder()
      return shuffleOrderIdsRef.current || []
    }
    return playbackListIdsRef.current.length > 0 ? playbackListIdsRef.current : tracksRef.current.map((t) => t.id)
  }, [ensureShuffleOrder])

  const findTrackById = useCallback((id: string) => {
    return trackByIdRef.current.get(id) || tracksRef.current.find((t) => t.id === id) || null
  }, [])

  const getQueueIds = useCallback(() => {
    const current = currentTrackRef.current
    if (!current) return []

    const sequence = getSequenceIds()
    if (sequence.length === 0) return []

    const removed = queueRemovedSetRef.current
    const idx = sequence.indexOf(current.id)
    const start = idx >= 0 ? idx + 1 : 1

    const ids: string[] = []

    if (playerStateRef.current.repeatMode === "all") {
      for (let offset = 0; offset < sequence.length - 1; offset++) {
        const i = (start + offset) % sequence.length
        const id = sequence[i]
        if (id && !removed.has(id)) ids.push(id)
      }
      return ids
    }

    for (let i = start; i < sequence.length; i++) {
      const id = sequence[i]
      if (id && !removed.has(id)) ids.push(id)
    }
    return ids
  }, [getSequenceIds])

  const getQueueIdsDisplay = useCallback(() => {
    const current = currentTrackRef.current
    if (!current) return []

    const sequence = getSequenceIds()
    if (sequence.length === 0) return []

    const removed = queueRemovedSetRef.current
    const idx = sequence.indexOf(current.id)
    const start = idx >= 0 ? idx + 1 : 1

    const ids: string[] = []
    for (let i = start; i < sequence.length; i++) {
      const id = sequence[i]
      if (id && !removed.has(id)) ids.push(id)
    }
    return ids
  }, [getSequenceIds])

  const enqueueTrackId = useCallback((trackId: string) => {
    setManualQueueIds((prev) => [...prev, trackId])
  }, [])

  const removeManualQueueIndex = useCallback((index: number) => {
    setManualQueueIds((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const consumeManualQueueThroughId = useCallback((trackId: string) => {
    setManualQueueIds((prev) => {
      const idx = prev.indexOf(trackId)
      if (idx === -1) return prev
      return prev.slice(idx + 1)
    })
  }, [])

  const getNextSpotifyQueueItem = useCallback((): { id: string; source: "manual" | "context" } | null => {
    const manual = manualQueueIdsRef.current
    if (manual.length > 0) return { id: manual[0], source: "manual" }
    const ctx = getQueueIds()[0]
    if (!ctx) return null
    return { id: ctx, source: "context" }
  }, [getQueueIds])

  const handleNext = useCallback((autoOrEvent: boolean | unknown = false) => {
    const current = currentTrackRef.current
    if (!current) return
    const auto = typeof autoOrEvent === "boolean" ? autoOrEvent : false

    const next = getNextSpotifyQueueItem()
    if (!next) {
      audioRef.current.pause()
      setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
      return
    }

    if (next.source === "manual") {
      removeManualQueueIndex(0)
    }

    const nextTrack = findTrackById(next.id)
    if (!nextTrack) return
    playTrack(nextTrack, auto)
  }, [findTrackById, getNextSpotifyQueueItem, playTrack, removeManualQueueIndex])

  const handlePrevious = useCallback(() => {
    const current = currentTrackRef.current
    const state = playerStateRef.current
    if (!current) return

    if (state.isShuffled && playbackHistoryRef.current.length > 0) {
      const prevId = playbackHistoryRef.current.pop()
      if (prevId) {
        const match = findTrackById(prevId)
        if (match) {
          playTrack(match, false)
          return
        }
      }
    }

    const sequence = getSequenceIds()
    if (sequence.length === 0) return

    const currentIndex = sequence.indexOf(current.id)
    if (currentIndex === -1) return

    let prevIndex = currentIndex - 1
    if (prevIndex < 0) {
      if (state.repeatMode !== "all") return
      prevIndex = sequence.length - 1
    }

    const prevId = sequence[prevIndex]
    if (!prevId) return
    const prevTrack = findTrackById(prevId)
    if (!prevTrack) return
    playTrack(prevTrack, false)
  }, [findTrackById, getSequenceIds, playTrack])

  useEffect(() => {
    const audio = audioRef.current

    const handleTimeUpdate = () => {
      setPlayerState((prev) => ({ ...prev, currentTime: audio.currentTime }))
    }

    const handleLoadedMetadata = () => {
      setPlayerState((prev) => ({ ...prev, duration: audio.duration }))
    }

    const handleEnded = () => {
      const current = currentTrackRef.current
      const state = playerStateRef.current
      const play = playTrackRef.current

      if (!current) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (state.repeatMode === "one") {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        setPlayerState((prev) => ({ ...prev, isPlaying: !audio.paused, currentTime: 0 }))
        return
      }

      const next = getNextSpotifyQueueItem()
      if (!next) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (!play) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (next.source === "manual") {
        removeManualQueueIndex(0)
      }

      const nextTrack = findTrackById(next.id)
      if (!nextTrack) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }
      play(nextTrack, false)
    }

    const handleError = () => {
      setPlayerState((prev) => ({ ...prev, isPlaying: false }))
    }

    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("error", handleError)

    return () => {
      audio.pause()
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("error", handleError)
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close()
        } catch {}
      }
    }
  }, [])

  const handleSeek = (time: number) => {
    setPlayerState((prev) => ({ ...prev, currentTime: time }));
    audioRef.current.currentTime = time;
  };

  const handleVolumeChange = (volume: number) => {
    setPlayerState((prev) => ({ ...prev, volume }));
  };

  const handleToggleMute = () => {
    setPlayerState((prev) => ({ ...prev, isMuted: !prev.isMuted }));
  };

  const handleToggleShuffle = () => {
    setPlayerState((prev) => {
      const nextIsShuffled = !prev.isShuffled
      playerStateRef.current = { ...prev, isShuffled: nextIsShuffled }
      if (nextIsShuffled) {
        shuffleNonceRef.current += 1
        shuffleOrderIdsRef.current = null
        ensureShuffleOrder()
      } else {
        shuffleOrderIdsRef.current = null
      }
      return { ...prev, isShuffled: nextIsShuffled }
    });
  };

  const handleToggleRepeat = () => {
    setPlayerState((prev) => {
      const modes: PlayerState["repeatMode"][] = ["off", "all", "one"];
      const nextIndex = (modes.indexOf(prev.repeatMode) + 1) % modes.length;
      const next = { ...prev, repeatMode: modes[nextIndex] };
      playerStateRef.current = next
      return next;
    });
  };

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleToggleCollapse = useCallback(() => setSidebarCollapsed(prev => !prev), []);
  const handleCreateFolder = useCallback(async () => {
    if (!selectedFolder) {
        alert("Please select a folder first to create a subfolder inside it.");
        return;
    }
    if (selectedFolder.source !== "local") {
        alert("Creating folders is only supported in local libraries.");
        return;
    }
    
    const name = prompt("Enter folder name:");
    if (!name) return;
    
    try {
        await invoke("create_folder", { name, parentPath: selectedFolder.path });
    } catch (e) {
        console.error("Failed to create folder:", e);
        alert("Failed to create folder: " + e);
    }
  }, [selectedFolder]);

  const handleAddLibraryFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === "string") {
        await invoke("add_music_folder", { path: selected });
      }
    } catch (error) {
      console.error("Failed to add library folder:", error);
    }
  };

  const handleToggleFavorite = useCallback(async (trackId: string) => {
    setFavorites(prev => {
        const next = new Set(prev);
        if (next.has(trackId)) next.delete(trackId);
        else next.add(trackId);
        
        invoke("load_config").then((c: any) => {
            invoke("save_config", { config: { ...c, favorites: Array.from(next) } });
        });
        
        return next;
    });
  }, []);

  const handlePlayFromSearch = useCallback((track: Track) => {
    const context = tracksRef.current.length > 0 ? tracksRef.current : tracks
    setPlaybackContext(context, "Library")
    if (playerStateRef.current.isShuffled) {
      shuffleNonceRef.current += 1
      shuffleOrderIdsRef.current = null
    }
    playTrack(track, false)
  }, [playTrack, setPlaybackContext, tracks])

  const handleAddToQueue = useCallback((track: Track) => {
    enqueueTrackId(track.id)
  }, [enqueueTrackId])

  const handleRemoveFromContextQueue = useCallback((trackId: string) => {
    setQueueRemovedIds((prev) => (prev.includes(trackId) ? prev : [...prev, trackId]))
  }, [])

  const manualQueueTracks = useMemo(() => {
    return manualQueueIds
      .map((id) => findTrackById(id))
      .filter((t): t is Track => !!t)
  }, [manualQueueIds, findTrackById, tracks])

  const contextQueueTracks = useMemo(() => {
    const manualSet = new Set(manualQueueIds)
    return getQueueIdsDisplay().filter((id) => !manualSet.has(id))
      .map((id) => findTrackById(id))
      .filter((t): t is Track => !!t)
  }, [tracks, currentTrack, playerState.isShuffled, playerState.repeatMode, queueRemovedIds, manualQueueIds, getQueueIdsDisplay, findTrackById])

  const handlePlayFromQueueScreen = useCallback((track: Track) => {
    if (track.id === currentTrackRef.current?.id) return
    consumeManualQueueThroughId(track.id)
    if (playerStateRef.current.isShuffled) {
      shuffleNonceRef.current += 1
      shuffleOrderIdsRef.current = null
    }
    playTrack(track, false)
  }, [consumeManualQueueThroughId, playTrack])

  const handleSelectArtist = useCallback((artist: string) => {
    if (!artist.trim()) return
    if (view !== "artist") lastNonArtistViewRef.current = view
    setSelectedArtist(artist)
    setView("artist")
  }, [view])

  const handleBackFromArtist = useCallback(() => {
    setView(lastNonArtistViewRef.current)
  }, [])

  const filteredTracks = useMemo(() => {
    const q = searchQuery ? searchQuery.toLowerCase() : ""
    return tracks.filter((t) => {
      if (q) {
        const matches =
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q)
        if (!matches) return false
      }

      if (view === "favorites") return favorites.has(t.canonicalId)
      if (view === "recent") return recentTracks.includes(t.canonicalId)
      return true
    })
  }, [tracks, searchQuery, view, favorites, recentTracks])

  const sortedTracks = useMemo(() => {
    if (view === "recent" && !searchQuery) {
      return [...filteredTracks].sort((a, b) => recentTracks.indexOf(a.canonicalId) - recentTracks.indexOf(b.canonicalId))
    }
    return filteredTracks
  }, [filteredTracks, view, searchQuery, recentTracks])

  const favoritesArray = useMemo(() => Array.from(favorites), [favorites])

  const handleFolderSelect = useCallback((folder: MusicFolder | null) => {
    setSelectedFolder(folder);
    if (folder) {
        setView("library");
    }
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      <Sidebar
        view={view}
        setView={setView}
        onOpenSettings={handleOpenSettings}
        onAddFolder={handleCreateFolder}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        folders={folders}
        onFolderSelect={handleFolderSelect}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header 
            currentTrack={currentTrack} 
            onSearch={setSearchQuery} 
            tracks={tracks} 
            onPlayTrack={handlePlayFromSearch}
            showWindowControls={showWindowControls}
            useNativeTitlebar={useNativeTitlebar}
        />

        <main className="flex-1 overflow-hidden relative">
          {view === "library" || view === "favorites" || view === "recent" ? (
            <TrackList
              tracks={sortedTracks}
              folders={folders}
              currentTrack={currentTrack}
              onTrackSelect={handleTrackSelect}
              onAddToQueue={handleAddToQueue}
              contextLabel={
                view === "favorites"
                  ? "Favorites"
                  : view === "recent"
                    ? "Recent"
                    : searchQuery
                      ? "Search"
                      : selectedFolder
                        ? selectedFolder.name
                        : "Library"
              }
              onSelectArtist={handleSelectArtist}
              isPlaying={playerState.isPlaying}
              selectedFolder={view === "favorites" || view === "recent" || searchQuery ? null : selectedFolder}
              onFolderSelect={setSelectedFolder}
              favorites={favoritesArray}
              onToggleFavorite={handleToggleFavorite}
              ignoreFolderFilter={view === "favorites" || view === "recent" || !!searchQuery}
              onNeedCovers={ensureCoversForAudioUrls}
            />
          ) : view === "queue" ? (
            <QueueView
              currentTrack={currentTrack}
              manualQueue={manualQueueTracks}
              contextQueue={contextQueueTracks}
              contextLabel={contextLabel}
              onPlayTrack={handlePlayFromQueueScreen}
              onRemoveManualQueueIndex={removeManualQueueIndex}
              onRemoveFromContextQueue={handleRemoveFromContextQueue}
              onSelectArtist={handleSelectArtist}
              onNeedCovers={ensureCoversForAudioUrls}
            />
          ) : view === "artist" && selectedArtist ? (
            <ArtistView
              artist={selectedArtist}
              tracks={tracks}
              currentTrack={currentTrack}
              isPlaying={playerState.isPlaying}
              onTrackSelect={handleTrackSelect}
              onAddToQueue={handleAddToQueue}
              onBack={handleBackFromArtist}
              onSelectArtist={handleSelectArtist}
              favorites={favoritesArray}
              onToggleFavorite={handleToggleFavorite}
              onNeedCovers={ensureCoversForAudioUrls}
            />
          ) : (
            <NowPlaying
              track={currentTrack}
              playerState={playerState}
              onPlayPause={handlePlayPause}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onSeek={handleSeek}
              onVolumeChange={handleVolumeChange}
              onToggleMute={handleToggleMute}
              onToggleShuffle={handleToggleShuffle}
              onToggleRepeat={handleToggleRepeat}
              onSelectArtist={handleSelectArtist}
            />
          )}
        </main>

        {view !== "nowplaying" && (
          <PlayerControls
            currentTrack={currentTrack}
            playerState={playerState}
            onPlayPause={handlePlayPause}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            onToggleShuffle={handleToggleShuffle}
            onToggleRepeat={handleToggleRepeat}
            onSelectArtist={handleSelectArtist}
          />
        )}
      </div>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onAddLibraryFolder={handleAddLibraryFolder}
          eqEnabled={eqEnabled}
          setEqEnabled={(enabled) => handleSaveEqSettings(enabled, eqPreset, eqValues, crossfade, normalize)}
          activePreset={eqPreset}
          setActivePreset={(preset) => {
            eqPresetRef.current = preset
            handleSaveEqSettings(eqEnabled, preset, eqValues, crossfade, normalize)
          }}
          eqValues={eqValues}
          setEqValues={(values) => handleSaveEqSettings(eqEnabled, eqPresetRef.current, values, crossfade, normalize)}
          crossfade={crossfade}
          setCrossfade={(val) => handleSaveEqSettings(eqEnabled, eqPreset, eqValues, val, normalize)}
          normalize={normalize}
          setNormalize={(val) => handleSaveEqSettings(eqEnabled, eqPreset, eqValues, crossfade, val)}
          useNativeTitlebar={useNativeTitlebar}
          setUseNativeTitlebar={handleSaveUseNativeTitlebar}
          showWindowControls={showWindowControls}
          setShowWindowControls={handleSaveWindowControls}
          themeOptions={themeOptions}
          selectedTheme={selectedTheme}
          setSelectedTheme={handleSaveSelectedTheme}
          discordRichPresence={discordRichPresence}
          setDiscordRichPresence={handleSaveDiscordRichPresence}
          testDiscordRichPresence={handleTestDiscordRichPresence}
          discordRpcError={discordRpcError}
          discordRpcTestSuccessAt={discordRpcTestSuccessAt}
        />
      )}
    </div>
  );
}

export default App;
