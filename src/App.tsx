import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TrackList } from "@/components/track-list";
import { NowPlaying } from "@/components/now-playing";
import { PlayerControls } from "@/components/player-controls";
import { SettingsPanel } from "@/components/settings-panel";
import type { Track, PlayerState, MusicFolder, AppConfig } from "@/lib/types";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

interface ScanResult {
  tracks: Track[];
  folders: MusicFolder[];
  revision: string;
}

function App() {
  const [view, setView] = useState<"library" | "nowplaying" | "favorites" | "recent">("library");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<MusicFolder | null>(null);

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

  useEffect(() => {
    playerStateRef.current = playerState
  }, [playerState])

  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  useEffect(() => {
    currentTrackRef.current = currentTrack
  }, [currentTrack])

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
      const coverUrl = await invoke<string | null>("get_cover_art", { path: audioUrl })
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

  const handleTrackSelect = useCallback((track: Track) => {
    playTrack(track, false);
  }, [playTrack]);

  const resolveTrackIndex = (list: Track[], track: Track) => {
    const byId = list.findIndex((t) => t.id === track.id)
    if (byId !== -1) return byId
    const byUrl = list.findIndex((t) => t.audioUrl === track.audioUrl)
    return byUrl === -1 ? 0 : byUrl
  }

  const handleNext = useCallback((autoOrEvent: boolean | unknown = false) => {
    const list = tracksRef.current
    const current = currentTrackRef.current
    const state = playerStateRef.current
    if (!current || list.length === 0) return
    const auto = typeof autoOrEvent === "boolean" ? autoOrEvent : false

    const currentIndex = resolveTrackIndex(list, current)

    if (state.isShuffled && list.length > 1) {
      let nextIndex = currentIndex
      for (let attempts = 0; attempts < 8 && nextIndex === currentIndex; attempts++) {
        nextIndex = Math.floor(Math.random() * list.length)
      }
      if (nextIndex === currentIndex) nextIndex = (currentIndex + 1) % list.length
      playTrack(list[nextIndex], auto)
      return
    }

    const nextIndex = (currentIndex + 1) % list.length
    playTrack(list[nextIndex], auto)
  }, [playTrack])

  const handlePrevious = useCallback(() => {
    const list = tracksRef.current
    const current = currentTrackRef.current
    const state = playerStateRef.current
    if (!current || list.length === 0) return

    if (state.isShuffled && playbackHistoryRef.current.length > 0) {
      const prevId = playbackHistoryRef.current.pop()
      if (prevId) {
        const match = list.find((t) => t.id === prevId)
        if (match) {
          playTrack(match, false)
          return
        }
      }
    }

    const currentIndex = resolveTrackIndex(list, current)
    const prevIndex = (currentIndex - 1 + list.length) % list.length
    playTrack(list[prevIndex], false)
  }, [playTrack])

  useEffect(() => {
    const audio = audioRef.current

    const handleTimeUpdate = () => {
      setPlayerState((prev) => ({ ...prev, currentTime: audio.currentTime }))
    }

    const handleLoadedMetadata = () => {
      setPlayerState((prev) => ({ ...prev, duration: audio.duration }))
    }

    const handleEnded = () => {
      const list = tracksRef.current
      const current = currentTrackRef.current
      const state = playerStateRef.current
      const play = playTrackRef.current

      if (!current || list.length === 0) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (state.repeatMode === "one") {
        audio.currentTime = 0
        void audio.play().catch(() => {})
        setPlayerState((prev) => ({ ...prev, isPlaying: !audio.paused, currentTime: 0 }))
        return
      }

      const currentIndex = resolveTrackIndex(list, current)

      if (state.repeatMode === "off" && currentIndex === list.length - 1) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (!play) {
        setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
        return
      }

      if (state.isShuffled && list.length > 1) {
        let nextIndex = currentIndex
        for (let attempts = 0; attempts < 8 && nextIndex === currentIndex; attempts++) {
          nextIndex = Math.floor(Math.random() * list.length)
        }
        if (nextIndex === currentIndex) nextIndex = (currentIndex + 1) % list.length
        play(list[nextIndex], false)
        return
      }

      const nextIndex = (currentIndex + 1) % list.length
      play(list[nextIndex], false)
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
    setPlayerState((prev) => ({ ...prev, isShuffled: !prev.isShuffled }));
  };

  const handleToggleRepeat = () => {
    setPlayerState((prev) => {
      const modes: PlayerState["repeatMode"][] = ["off", "all", "one"];
      const nextIndex = (modes.indexOf(prev.repeatMode) + 1) % modes.length;
      return { ...prev, repeatMode: modes[nextIndex] };
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
            onPlayTrack={handleTrackSelect}
        />

        <main className="flex-1 overflow-hidden relative">
          {view === "library" || view === "favorites" || view === "recent" ? (
            <TrackList
              tracks={sortedTracks}
              folders={folders}
              currentTrack={currentTrack}
              onTrackSelect={handleTrackSelect}
              isPlaying={playerState.isPlaying}
              selectedFolder={view === "favorites" || view === "recent" || searchQuery ? null : selectedFolder}
              onFolderSelect={setSelectedFolder}
              favorites={favoritesArray}
              onToggleFavorite={handleToggleFavorite}
              ignoreFolderFilter={view === "favorites" || view === "recent" || !!searchQuery}
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
        />
      )}
    </div>
  );
}

export default App;
