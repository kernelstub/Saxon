import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TrackList } from "@/components/track-list";
import { NowPlaying } from "@/components/now-playing";
import { PlayerControls } from "@/components/player-controls";
import { SettingsPanel } from "@/components/settings-panel";
import type { Track, PlayerState, MusicFolder, AppConfig } from "@/lib/types";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";

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
  const [crossfade, setCrossfade] = useState(5)
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

  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const audioPathRef = useRef<string | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null)
  const audioCacheRef = useRef<Map<string, string>>(new Map())
  const coverCacheRef = useRef<Map<string, string>>(new Map())
  const coverInFlightRef = useRef<Set<string>>(new Set())
  const refreshInFlightRef = useRef(false)
  const libraryRevisionRef = useRef<string | null>(null)

  const applyCachedCovers = useCallback((nextTracks: Track[]) => {
    const coverCache = coverCacheRef.current
    return nextTracks.map((t) => {
      const cached = coverCache.get(t.audioUrl)
      return cached ? { ...t, coverUrl: cached } : t
    })
  }, [])

  const ensureCoverForAudioUrl = useCallback(async (audioUrl: string) => {
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

        if (prunedPaths.length > 0) {
          const results = await Promise.all(
            prunedPaths.map((path) =>
              invoke<ScanResult>("scan_music_library", { path }),
            ),
          );

          const tracksByPath = new Map<string, Track>();
          const foldersByPath = new Map<string, MusicFolder>();

          results.forEach((result) => {
            result.tracks.forEach((t) => tracksByPath.set(t.audioUrl, t));
            result.folders.forEach((f) => foldersByPath.set(f.path, f));
          });

          const combinedRevision = results.map((r) => r.revision).join("|")
          libraryRevisionRef.current = combinedRevision

          const nextTracks = applyCachedCovers(Array.from(tracksByPath.values()))
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
        
        if (folders.length > 0) {
          const results = await Promise.all(
            folders.map((path) =>
              invoke<ScanResult>("scan_music_library", { path }),
            ),
          );

          const combinedRevision = results.map((r) => r.revision).join("|")
          if (libraryRevisionRef.current === combinedRevision) return
          libraryRevisionRef.current = combinedRevision

          const tracksByPath = new Map<string, Track>();
          const foldersByPath = new Map<string, MusicFolder>();

          results.forEach((result) => {
            result.tracks.forEach((t) => tracksByPath.set(t.audioUrl, t));
            result.folders.forEach((f) => foldersByPath.set(f.path, f));
          });

          const nextTracks = applyCachedCovers(Array.from(tracksByPath.values()))
          const nextFolders = Array.from(foldersByPath.values())
          startTransition(() => {
            setTracks(nextTracks)
            setFolders(nextFolders)
          })
        }
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

  useEffect(() => {
    const audio = audioRef.current

    const handleTimeUpdate = () => {
      setPlayerState((prev) => ({ ...prev, currentTime: audio.currentTime }))
    }

    const handleLoadedMetadata = () => {
      setPlayerState((prev) => ({ ...prev, duration: audio.duration }))
    }

    const handleEnded = () => {
      setPlayerState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
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
      for (const url of audioCacheRef.current.values()) URL.revokeObjectURL(url)
      audioCacheRef.current.clear()
      if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
  }, []);

  const startPlayback = async (track: Track) => {
    const audio = audioRef.current

    try {
      await ensureAudioGraph()
      const getMimeType = (path: string) => {
        const ext = path.split(".").pop()?.toLowerCase()
        if (ext === "mp3") return "audio/mpeg"
        if (ext === "wav") return "audio/wav"
        if (ext === "ogg") return "audio/ogg"
        if (ext === "flac") return "audio/flac"
        if (ext === "m4a") return "audio/mp4"
        if (ext === "aac") return "audio/aac"
        return "audio/*"
      }

      const cachedUrl = audioCacheRef.current.get(track.audioUrl)

      if (audioPathRef.current !== track.audioUrl) {
        audio.pause()
        audio.currentTime = 0

        if (cachedUrl) {
          audio.src = cachedUrl
        } else {
          const data = await readFile(track.audioUrl)
          const blob = new Blob([data], { type: getMimeType(track.audioUrl) })
          const url = URL.createObjectURL(blob)
          audioCacheRef.current.set(track.audioUrl, url)
          if (audioCacheRef.current.size > 50) {
            const firstKey = audioCacheRef.current.keys().next().value as string | undefined
            if (firstKey) {
              const firstUrl = audioCacheRef.current.get(firstKey)
              if (firstUrl) URL.revokeObjectURL(firstUrl)
              audioCacheRef.current.delete(firstKey)
            }
          }
          audioBlobUrlRef.current = url
          audio.src = url
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
        setCurrentTrack(track);
        void ensureCoverForAudioUrl(track.audioUrl)
        setPlayerState((prev) => ({
          ...prev,
          isPlaying: true,
          currentTime: 0,
          duration: track.duration,
        }));
        addToRecent(track.id);
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

  const handleTrackSelect = useCallback((track: Track) => {
    playTrack(track, false);
  }, [playTrack]);

  const handleNext = (auto: boolean = false) => {
    if (!currentTrack) return;
    const currentIndex = tracks.findIndex((t) => t.id === currentTrack.id);
    const nextIndex = (currentIndex + 1) % tracks.length;
    playTrack(tracks[nextIndex], auto);
  };

  const handlePrevious = () => {
    if (!currentTrack) return;
    const currentIndex = tracks.findIndex((t) => t.id === currentTrack.id);
    const prevIndex = (currentIndex - 1 + tracks.length) % tracks.length;
    playTrack(tracks[prevIndex], false);
  };

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

      if (view === "favorites") return favorites.has(t.id)
      if (view === "recent") return recentTracks.includes(t.id)
      return true
    })
  }, [tracks, searchQuery, view, favorites, recentTracks])

  const sortedTracks = useMemo(() => {
    if (view === "recent" && !searchQuery) {
      return [...filteredTracks].sort((a, b) => recentTracks.indexOf(a.id) - recentTracks.indexOf(b.id))
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
