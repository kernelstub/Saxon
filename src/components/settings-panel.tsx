import { X, Volume2, Music, Info, FolderPlus, Server, RefreshCcw, ChevronDown } from "lucide-react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { NavidromeServerConfig } from "@/lib/types"

interface SettingsPanelProps {
  onClose: () => void
  onAddLibraryFolder: () => void
  eqEnabled: boolean
  setEqEnabled: (enabled: boolean) => void
  activePreset: string
  setActivePreset: (preset: string) => void
  eqValues: number[]
  setEqValues: (values: number[]) => void
  crossfade: number
  setCrossfade: (value: number) => void
  normalize: boolean
  setNormalize: (enabled: boolean) => void
  showWindowControls: boolean
  setShowWindowControls: (enabled: boolean) => void
  themeOptions: string[]
  selectedTheme: string
  setSelectedTheme: (theme: string) => void
  discordRichPresence: boolean
  setDiscordRichPresence: (enabled: boolean) => void
  testDiscordRichPresence: () => void
  discordRpcError: string | null
  discordRpcTestSuccessAt: number | null
}

const eqBands = [
  { id: "32", label: "32Hz", defaultValue: 50 },
  { id: "64", label: "64Hz", defaultValue: 50 },
  { id: "125", label: "125Hz", defaultValue: 50 },
  { id: "250", label: "250Hz", defaultValue: 50 },
  { id: "500", label: "500Hz", defaultValue: 50 },
  { id: "1k", label: "1kHz", defaultValue: 50 },
  { id: "2k", label: "2kHz", defaultValue: 50 },
  { id: "4k", label: "4kHz", defaultValue: 50 },
  { id: "8k", label: "8kHz", defaultValue: 50 },
  { id: "16k", label: "16kHz", defaultValue: 50 },
]

const eqPresets = [
  { id: "flat", name: "Flat", values: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50] },
  { id: "bass", name: "Bass Boost", values: [80, 75, 65, 55, 50, 50, 50, 50, 50, 50] },
  { id: "treble", name: "Treble Boost", values: [50, 50, 50, 50, 50, 55, 65, 75, 80, 85] },
  { id: "vocal", name: "Vocal", values: [40, 45, 55, 65, 70, 70, 65, 55, 45, 40] },
  { id: "rock", name: "Rock", values: [70, 65, 55, 45, 50, 55, 65, 70, 70, 70] },
  { id: "electronic", name: "Electronic", values: [75, 70, 50, 45, 50, 60, 55, 70, 75, 75] },
]

export function SettingsPanel({ 
  onClose, 
  onAddLibraryFolder,
  eqEnabled,
  setEqEnabled,
  activePreset,
  setActivePreset,
  eqValues,
  setEqValues,
  crossfade,
  setCrossfade,
  normalize,
  setNormalize,
  showWindowControls,
  setShowWindowControls,
  themeOptions,
  selectedTheme,
  setSelectedTheme,
  discordRichPresence,
  setDiscordRichPresence,
  discordRpcError,
  discordRpcTestSuccessAt
}: SettingsPanelProps) {
  const [loadedFolders, setLoadedFolders] = useState<string[]>([])
  const [navidromeServers, setNavidromeServers] = useState<NavidromeServerConfig[]>([])
  const [navidromeName, setNavidromeName] = useState("Navidrome")
  const [navidromeBaseUrl, setNavidromeBaseUrl] = useState("")
  const [navidromeUsername, setNavidromeUsername] = useState("")
  const [navidromePassword, setNavidromePassword] = useState("")
  const [navidromeApiKey, setNavidromeApiKey] = useState("")
  const [navidromeBusy, setNavidromeBusy] = useState(false)

  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("load_config").then((c: any) => {
            if (c.musicFolders) setLoadedFolders(c.musicFolders)
            if (c.navidromeServers) setNavidromeServers(c.navidromeServers)
        })
    })
  }, [])

  const handleRemoveFolder = async (path: string) => {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        const newFolders = await invoke<string[]>("remove_music_folder", { path });
        setLoadedFolders(newFolders);
    } catch (e) {
        console.error("Failed to remove folder", e);
    }
  }

  const handlePresetChange = (presetId: string) => {
    if (presetId === "custom") {
      setActivePreset("custom")
      return
    }
    const preset = eqPresets.find((p) => p.id === presetId)
    if (preset) {
      setActivePreset(presetId)
      setEqValues([...preset.values])
    }
  }

  const handleBandChange = (index: number, value: number[]) => {
    const newValues = [...eqValues]
    newValues[index] = value[0]
    setActivePreset("custom")
    setEqValues(newValues)
  }

  const handleAddFolder = async () => {
     onAddLibraryFolder();
     
     setTimeout(() => {
        import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("load_config").then((c: any) => {
                if (c.musicFolders) setLoadedFolders(c.musicFolders)
            })
        })
     }, 1000)
  }

  const persistNavidromeServers = async (servers: NavidromeServerConfig[]) => {
    const { invoke } = await import("@tauri-apps/api/core")
    const c: any = await invoke("load_config")
    await invoke("save_config", { config: { ...c, navidromeServers: servers } })
  }

  const handleAddNavidromeServer = async () => {
    const hasPassword = !!navidromePassword.trim()
    const hasApiKey = !!navidromeApiKey.trim()
    if (!navidromeBaseUrl || !navidromeUsername || (!hasPassword && !hasApiKey)) return
    setNavidromeBusy(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      const created = await invoke<NavidromeServerConfig>("navidrome_create_server", {
        name: navidromeName || "Navidrome",
        baseUrl: navidromeBaseUrl,
        username: navidromeUsername,
        password: hasApiKey ? null : navidromePassword,
        apiKey: hasApiKey ? navidromeApiKey : null,
      })
      const next = [...navidromeServers, created]
      setNavidromeServers(next)
      await persistNavidromeServers(next)
      setNavidromePassword("")
      setNavidromeApiKey("")
    } catch (e) {
      alert("Failed to add Navidrome server: " + e)
    } finally {
      setNavidromeBusy(false)
    }
  }

  const handleRemoveNavidromeServer = async (id: string) => {
    const next = navidromeServers.filter((s) => s.id !== id)
    setNavidromeServers(next)
    try {
      await persistNavidromeServers(next)
    } catch (e) {
      alert("Failed to save Navidrome servers: " + e)
    }
  }

  const handleToggleNavidromeServer = async (id: string, enabled: boolean) => {
    const next = navidromeServers.map((s) => (s.id === id ? { ...s, enabled } : s))
    setNavidromeServers(next)
    try {
      await persistNavidromeServers(next)
    } catch (e) {
      alert("Failed to save Navidrome servers: " + e)
    }
  }

  const handleTestNavidromeServer = async (id: string) => {
    setNavidromeBusy(true)
    try {
      const { invoke } = await import("@tauri-apps/api/core")
      await invoke("navidrome_test_connection", { serverId: id })
      alert("Navidrome connection OK")
    } catch (e) {
      alert("Navidrome connection failed: " + e)
    } finally {
      setNavidromeBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card rounded-2xl shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
              <Volume2 className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Settings</h2>
              <p className="text-sm text-muted-foreground">Audio & Equalizer</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="rounded-lg" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <ScrollArea className="h-[calc(80vh-140px)]">
          <div className="p-6 space-y-6">
            <div className="space-y-4">
              <Label className="text-sm font-medium flex items-center gap-2">
                <FolderPlus className="w-4 h-4" />
                Library
              </Label>
              <div className="bg-secondary/50 rounded-xl p-4 border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Music Folders</span>
                    <p className="text-xs text-muted-foreground">Manage your music library locations</p>
                  </div>
                  <Button onClick={handleAddFolder} size="sm" className="rounded-lg">
                    Add Folder
                  </Button>
                </div>
                
                <div className="space-y-2">
                    {loadedFolders.map((folder, i) => (
                        <div key={i} className="flex items-center justify-between bg-background/50 p-2 rounded-lg text-xs">
                            <span className="truncate flex-1 mr-2 font-mono" title={folder}>{folder}</span>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleRemoveFolder(folder)}
                            >
                                <X className="w-3 h-3" />
                            </Button>
                        </div>
                    ))}
                    {loadedFolders.length === 0 && (
                        <div className="text-center py-2 text-xs text-muted-foreground italic">
                            No folders added yet
                        </div>
                    )}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Window
                </Label>
                <Switch checked={showWindowControls} onCheckedChange={setShowWindowControls} />
              </div>
              <p className="text-xs text-muted-foreground">
                Show minimize and close buttons in the top bar
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Theme
                </Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="rounded-lg">
                      <span className="max-w-40 truncate">{selectedTheme || "default"}</span>
                      <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {themeOptions.length > 0 ? (
                      themeOptions.map((name) => (
                        <DropdownMenuItem key={name} onClick={() => setSelectedTheme(name)}>
                          {name}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>No themes found</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-xs text-muted-foreground">
                Themes come from sections in color.ini (for example [default], [purple], [oled])
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Discord Rich Presence
                </Label>
                <Switch checked={discordRichPresence} onCheckedChange={setDiscordRichPresence} />
              </div>
              {discordRichPresence && !discordRpcError && discordRpcTestSuccessAt && (
                <div className="text-xs text-emerald-500">
                  Test sent.
                </div>
              )}
              {discordRichPresence && discordRpcError && (
                <div className="text-xs text-destructive">
                  {discordRpcError}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Discord must be running. Shows current track in your profile.
              </p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Music className="w-4 h-4" />
                  Equalizer
                </Label>
                <Switch checked={eqEnabled} onCheckedChange={setEqEnabled} />
              </div>

              {eqEnabled && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {eqPresets.map((preset) => (
                      <Button
                        key={preset.id}
                        variant={activePreset === preset.id ? "secondary" : "outline"}
                        size="sm"
                        className="rounded-lg text-xs"
                        onClick={() => handlePresetChange(preset.id)}
                      >
                        {preset.name}
                      </Button>
                    ))}
                    <Button
                      variant={activePreset === "custom" ? "secondary" : "outline"}
                      size="sm"
                      className="rounded-lg text-xs"
                      onClick={() => handlePresetChange("custom")}
                    >
                      Custom
                    </Button>
                  </div>

                  <div className="bg-secondary/50 rounded-xl p-4 border border-border">
                    <div className="flex items-end justify-between gap-2 h-48">
                      {eqBands.map((band, index) => (
                        <div key={band.id} className="flex flex-col items-center flex-1 h-full">
                          <div className="flex-1 flex items-center justify-center w-full">
                            <Slider
                              orientation="vertical"
                              value={[eqValues[index]]}
                              onValueChange={(value) => handleBandChange(index, value)}
                              max={100}
                              min={0}
                              step={1}
                              className="h-full"
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-2 whitespace-nowrap">{band.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-3 px-1">
                      <span>+12dB</span>
                      <span>0dB</span>
                      <span>-12dB</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4" />
                Navidrome
              </Label>
              <div className="bg-secondary/50 rounded-xl p-4 border border-border space-y-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input value={navidromeName} onChange={(e) => setNavidromeName(e.target.value)} placeholder="Navidrome" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Base URL</Label>
                      <Input
                        value={navidromeBaseUrl}
                        onChange={(e) => setNavidromeBaseUrl(e.target.value)}
                        placeholder="https://navidrome.example.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Username</Label>
                      <Input value={navidromeUsername} onChange={(e) => setNavidromeUsername(e.target.value)} placeholder="username" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Password</Label>
                      <Input
                        type="password"
                        value={navidromePassword}
                        onChange={(e) => setNavidromePassword(e.target.value)}
                        placeholder="password"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">OpenSubsonic API Key (optional)</Label>
                      <Input
                        value={navidromeApiKey}
                        onChange={(e) => setNavidromeApiKey(e.target.value)}
                        placeholder="apiKey"
                      />
                    </div>
                    <div />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Saxon uses OpenSubsonic-compatible endpoints and can authenticate via token+salt or an API key.
                    </p>
                    <Button
                      onClick={handleAddNavidromeServer}
                      size="sm"
                      className="rounded-lg"
                      disabled={navidromeBusy || !navidromeBaseUrl || !navidromeUsername || (!navidromePassword.trim() && !navidromeApiKey.trim())}
                    >
                      Add Server
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {navidromeServers.map((server) => (
                    <div key={server.id} className="flex items-center justify-between bg-background/50 p-3 rounded-xl border border-border">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{server.name}</span>
                          <span className="text-xs text-muted-foreground truncate">{server.baseUrl}</span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{server.username}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={server.enabled} onCheckedChange={(v) => handleToggleNavidromeServer(server.id, v)} />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          onClick={() => handleTestNavidromeServer(server.id)}
                          disabled={navidromeBusy}
                        >
                          <RefreshCcw className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveNavidromeServer(server.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {navidromeServers.length === 0 && (
                    <div className="text-center py-2 text-xs text-muted-foreground italic">
                      No Navidrome servers added yet
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <Label className="text-sm font-medium">Playback</Label>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Crossfade</span>
                  <span className="text-sm font-medium tabular-nums">{crossfade}s</span>
                </div>
                <Slider
                  value={[crossfade]}
                  onValueChange={(value) => setCrossfade(value[0])}
                  max={12}
                  min={0}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Normalize Volume</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically adjust volume to the same level
                  </div>
                </div>
                <Switch
                  checked={normalize}
                  onCheckedChange={setNormalize}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Info className="w-4 h-4" />
                About
              </Label>
              <div className="bg-secondary/50 rounded-xl p-4 border border-border space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Repo</span>
                  <span>github.com/kernelstub/Saxon</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Built with</span>
                  <span>Tauri v2, React, TypeScript</span>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 p-6 border-t border-border">
          <Button variant="ghost" onClick={onClose} className="rounded-lg">
            Close
          </Button>
          <Button onClick={onClose} className="rounded-lg">
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
