use base64::prelude::*;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use lofty::{Accessor, AudioFile, Probe, TaggedFileExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tiny_http::{Header, Method, Response, StatusCode};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

mod navidrome;

const DISCORD_CLIENT_ID: &str = "1463766565664067594";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    canonical_id: String,
    title: String,
    artist: String,
    album: String,
    duration: u64,
    cover_url: Option<String>,
    audio_url: String,
    folder_id: Option<String>,
    source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MusicFolder {
    id: String,
    parent_id: Option<String>,
    name: String,
    path: String,
    track_count: usize,
    source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    tracks: Vec<Track>,
    folders: Vec<MusicFolder>,
    revision: String,
}

#[derive(Clone)]
struct CoverEntry {
    mime: String,
    bytes: Vec<u8>,
}

#[derive(Clone)]
struct CoverServerState {
    base_url: String,
    entries: Arc<Mutex<HashMap<String, CoverEntry>>>,
}

static COVER_SERVER_STATE: LazyLock<Mutex<Option<CoverServerState>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(alias = "music_folders")]
    music_folders: Vec<String>,
    #[serde(default)]
    favorites: Vec<String>,
    #[serde(default)]
    recent_tracks: Vec<String>,
    #[serde(default = "default_eq_enabled")]
    eq_enabled: bool,
    #[serde(default = "default_eq_preset")]
    eq_preset: String,
    #[serde(default = "default_eq_values")]
    eq_values: Vec<i32>,
    #[serde(default = "default_crossfade")]
    crossfade: u32,
    #[serde(default = "default_normalize")]
    normalize: bool,
    #[serde(default)]
    show_window_controls: bool,
    #[serde(default)]
    use_native_titlebar: bool,
    #[serde(default)]
    selected_theme: Option<String>,
    #[serde(default)]
    discord_rich_presence: bool,
    #[serde(default)]
    navidrome_servers: Vec<NavidromeServerConfig>,
    #[serde(default)]
    playlist_collage_covers: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct NavidromeServerConfig {
    id: String,
    name: String,
    base_url: String,
    username: String,
    token: String,
    salt: String,
    #[serde(default)]
    api_key: Option<String>,
    enabled: bool,
}

fn default_eq_enabled() -> bool {
    true
}

fn default_eq_preset() -> String {
    "flat".to_string()
}

fn default_eq_values() -> Vec<i32> {
    vec![50; 10]
}

fn default_crossfade() -> u32 {
    5
}

fn default_normalize() -> bool {
    false
}

#[tauri::command]
fn create_folder(name: String, parent_path: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(name);
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_track(path: String) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn show_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/")))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    use tauri::Manager;
    let config_path = app.path().resolve("config.json", tauri::path::BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())?;
    
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    use tauri::Manager;
    let config_path = app.path().resolve("config.json", tauri::path::BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())?;

    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let json = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
    let config: AppConfig = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(config)
}

fn default_color_ini() -> String {
    [
        "[default]",
        "background=#0f0f0f",
        "foreground=#f2f2f2",
        "card=#141414",
        "card-foreground=#f2f2f2",
        "popover=#141414",
        "popover-foreground=#f2f2f2",
        "primary=#b3b3b3",
        "primary-foreground=#0f0f0f",
        "secondary=#262626",
        "secondary-foreground=#f2f2f2",
        "muted=#262626",
        "muted-foreground=#999999",
        "accent=#333333",
        "accent-foreground=#f2f2f2",
        "destructive=#ef4444",
        "destructive-foreground=#f2f2f2",
        "border=#333333",
        "input=#262626",
        "ring=#808080",
        "chart-1=#b3b3b3",
        "chart-2=#999999",
        "chart-3=#808080",
        "chart-4=#666666",
        "chart-5=#4d4d4d",
        "radius=0.625rem",
        "sidebar=#0a0a0a",
        "sidebar-foreground=#f2f2f2",
        "sidebar-primary=#cccccc",
        "sidebar-primary-foreground=#0f0f0f",
        "sidebar-accent=#262626",
        "sidebar-accent-foreground=#f2f2f2",
        "sidebar-border=#1f1f1f",
        "sidebar-ring=#808080",
        "scrollbar-thumb=#6666664D",
        "scrollbar-thumb-hover=#80808080",
        "range-track=#333333",
        "range-thumb=#cccccc",
    ]
    .join("\n")
}

#[derive(Serialize, Clone, Debug)]
struct ColorIniThemes {
    themes: std::collections::HashMap<String, std::collections::HashMap<String, String>>,
    order: Vec<String>,
}

fn parse_color_ini_themes(input: &str) -> ColorIniThemes {
    let mut themes: std::collections::HashMap<String, std::collections::HashMap<String, String>> = std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut section = "default".to_string();

    for raw_line in input.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim();
            if !name.is_empty() {
                section = name.to_string();
                themes.entry(section.clone()).or_insert_with(std::collections::HashMap::new);
                if !order.iter().any(|s| s == &section) {
                    order.push(section.clone());
                }
            }
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }
        themes
            .entry(section.clone())
            .or_insert_with(std::collections::HashMap::new)
            .insert(key.to_string(), value.to_string());
        if !order.iter().any(|s| s == &section) {
            order.push(section.clone());
        }
    }

    ColorIniThemes { themes, order }
}

fn parse_color_ini(input: &str) -> std::collections::HashMap<String, String> {
    let parsed = parse_color_ini_themes(input);
    if let Some(theme) = parsed.themes.get("default") {
        return theme.clone();
    }
    if let Some(first) = parsed.order.first() {
        return parsed.themes.get(first).cloned().unwrap_or_default();
    }
    std::collections::HashMap::new()
}

fn extract_cover_bytes(path: &str) -> Result<Option<CoverEntry>, String> {
    const MAX_COVER_ART_BYTES: usize = 5 * 1024 * 1024;
    let tagged_file = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        Probe::open(Path::new(path))
            .map_err(|e| e.to_string())?
            .read()
            .map_err(|e| e.to_string())
    }))
    .map_err(|_| "panic while reading cover art".to_string())??;
    let tag = tagged_file.primary_tag();
    if let Some(tag) = tag {
        if let Some(picture) = tag.pictures().first() {
            if picture.data().len() > MAX_COVER_ART_BYTES {
                return Ok(None);
            }
            return Ok(Some(CoverEntry {
                mime: picture.mime_type().to_string(),
                bytes: picture.data().to_vec(),
            }));
        }
    }
    Ok(None)
}

fn ensure_cover_server() -> Result<CoverServerState, String> {
    let mut guard = COVER_SERVER_STATE.lock().map_err(|_| "cover server mutex poisoned".to_string())?;
    if let Some(state) = guard.as_ref() {
        return Ok(state.clone());
    }

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    let server = tiny_http::Server::from_listener(listener, None).map_err(|e| e.to_string())?;

    let entries: Arc<Mutex<HashMap<String, CoverEntry>>> = Arc::new(Mutex::new(HashMap::new()));
    let entries_for_thread = entries.clone();

    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            if request.method() != &Method::Get {
                let _ = request.respond(Response::empty(StatusCode(405)));
                continue;
            }

            let url = request.url().to_string();
            let id = url.strip_prefix("/cover/").unwrap_or("");
            if id.is_empty() || id.contains('/') {
                let _ = request.respond(Response::empty(StatusCode(404)));
                continue;
            }

            let entry = entries_for_thread.lock().ok().and_then(|m| m.get(id).cloned());
            if let Some(entry) = entry {
                let mut resp = Response::from_data(entry.bytes).with_status_code(StatusCode(200));
                if let Ok(h) = Header::from_bytes("Content-Type", entry.mime.as_bytes()) {
                    resp = resp.with_header(h);
                }
                if let Ok(h) = Header::from_bytes("Cache-Control", "public, max-age=604800".as_bytes()) {
                    resp = resp.with_header(h);
                }
                let _ = request.respond(resp);
            } else {
                let _ = request.respond(Response::empty(StatusCode(404)));
            }
        }
    });

    let state = CoverServerState {
        base_url: format!("http://127.0.0.1:{}", addr.port()),
        entries,
    };
    *guard = Some(state.clone());
    Ok(state)
}

#[tauri::command]
fn load_color_themes(app: tauri::AppHandle) -> Result<ColorIniThemes, String> {
    use tauri::Manager;
    let ini_path = app
        .path()
        .resolve("color.ini", tauri::path::BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())?;

    if let Some(parent) = ini_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if !ini_path.exists() {
        std::fs::write(&ini_path, default_color_ini()).map_err(|e| e.to_string())?;
    }

    let raw = std::fs::read_to_string(&ini_path).map_err(|e| e.to_string())?;
    let parsed = parse_color_ini_themes(&raw);
    if parsed.themes.is_empty() {
        std::fs::write(&ini_path, default_color_ini()).map_err(|e| e.to_string())?;
        let raw = std::fs::read_to_string(&ini_path).map_err(|e| e.to_string())?;
        return Ok(parse_color_ini_themes(&raw));
    }
    Ok(parsed)
}

#[tauri::command]
fn load_color_ini(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    use tauri::Manager;
    let ini_path = app
        .path()
        .resolve("color.ini", tauri::path::BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())?;

    if let Some(parent) = ini_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if !ini_path.exists() {
        std::fs::write(&ini_path, default_color_ini()).map_err(|e| e.to_string())?;
    }

    let raw = std::fs::read_to_string(ini_path).map_err(|e| e.to_string())?;
    Ok(parse_color_ini(&raw))
}

#[derive(Default)]
struct DiscordRpcState {
    inner: Mutex<DiscordRpcInner>,
}

#[derive(Default)]
struct DiscordRpcInner {
    client_id: Option<String>,
    client: Option<DiscordIpcClient>,
}

fn discord_rpc_disconnect(inner: &mut DiscordRpcInner) {
    if let Some(mut client) = inner.client.take() {
        let _ = client.close();
    }
    inner.client_id = None;
}

fn discord_rpc_ensure_connected<'a>(
    inner: &'a mut DiscordRpcInner,
    client_id: &str,
) -> Result<&'a mut DiscordIpcClient, String> {
    let needs_reconnect = inner.client.is_none()
        || match inner.client_id.as_deref() {
            Some(existing) => existing != client_id,
            None => true,
        };

    if needs_reconnect {
        discord_rpc_disconnect(inner);
        let mut client = DiscordIpcClient::new(client_id);
        client.connect().map_err(|e| e.to_string())?;
        inner.client_id = Some(client_id.to_string());
        inner.client = Some(client);
    }

    Ok(inner.client.as_mut().expect("client must exist"))
}

#[tauri::command]
fn discord_rpc_clear(state: tauri::State<DiscordRpcState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "discord mutex poisoned".to_string())?;
    if let Some(client) = guard.client.as_mut() {
        let _ = client.clear_activity();
    }
    discord_rpc_disconnect(&mut guard);
    Ok(())
}

#[tauri::command]
fn discord_rpc_connect(state: tauri::State<DiscordRpcState>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "discord mutex poisoned".to_string())?;
    let _ = discord_rpc_ensure_connected(&mut guard, DISCORD_CLIENT_ID)?;
    Ok(())
}

#[tauri::command]
fn discord_rpc_set_activity(
    state: tauri::State<DiscordRpcState>,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    duration_ms: u64,
    position_ms: u64,
    is_playing: bool,
) -> Result<(), String> {
    let _ = album;
    let _ = cover_url;
    let mut guard = state.inner.lock().map_err(|_| "discord mutex poisoned".to_string())?;
    let client = discord_rpc_ensure_connected(&mut guard, DISCORD_CLIENT_ID)?;

    let mut state_line = artist.clone();
    if !is_playing {
        if state_line.is_empty() {
            state_line = "Paused".to_string();
        } else {
            state_line = format!("Paused • {}", state_line);
        }
    }

    let mut activity_payload = activity::Activity::new()
        .details(&title)
        .state(&state_line);

    if is_playing {
        activity_payload = activity_payload.activity_type(activity::ActivityType::Listening);
    }

    activity_payload = activity_payload.assets(activity::Assets::new().large_image("saxon"));

    if is_playing && duration_ms > 0 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs() as i64;
        let start = now.saturating_sub((position_ms / 1000) as i64);
        let end = start.saturating_add((duration_ms / 1000) as i64);
        activity_payload = activity_payload.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    let payload = activity_payload.clone();
    match client.set_activity(payload) {
        Ok(()) => Ok(()),
        Err(_) => {
            discord_rpc_disconnect(&mut guard);
            let client = discord_rpc_ensure_connected(&mut guard, DISCORD_CLIENT_ID)?;
            client.set_activity(activity_payload).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_decorations(window: tauri::Window, enabled: bool) -> Result<(), String> {
    window.set_decorations(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn add_music_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let mut config = load_config(app.clone())?;
    
    let new_path_buf = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    
    let mut current_paths: Vec<PathBuf> = config.music_folders.iter()
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .collect();
        
    if !current_paths.iter().any(|p| new_path_buf.starts_with(p)) {
         current_paths.push(new_path_buf);
    }
    
    current_paths.sort(); 
    current_paths.dedup();
    
    let mut kept_paths = Vec::new();
    for path in &current_paths {
        let is_child = kept_paths.iter().any(|parent| path.starts_with(parent) && path != parent);
        if !is_child {
            kept_paths.push(path.clone());
        }
    }
    
    config.music_folders = kept_paths.into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
        
    save_config(app, config.clone())?;
    
    Ok(config.music_folders)
}

#[tauri::command]
fn prune_music_folders(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut config = load_config(app.clone())?;
    
    let mut valid_paths = Vec::new();
    for p in &config.music_folders {
        if let Ok(canon) = std::fs::canonicalize(p) {
            valid_paths.push(canon);
        }
    }
    
    valid_paths.sort();
    valid_paths.dedup();
    
    let mut kept_paths = Vec::new();
    for path in &valid_paths {
        let is_child = kept_paths.iter().any(|parent| path.starts_with(parent) && path != parent);
        if !is_child {
            kept_paths.push(path.clone());
        }
    }
    
    config.music_folders = kept_paths.into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
        
    save_config(app, config.clone())?;
    Ok(config.music_folders)
}

#[derive(Clone)]
struct CachedTrack {
    track: Track,
    modified: u64,
    size: u64,
}

#[derive(Default)]
struct CachedLibrary {
    tracks: HashMap<String, CachedTrack>,
}

static SCAN_CACHE: LazyLock<Mutex<HashMap<String, CachedLibrary>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
fn remove_music_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let mut config = load_config(app.clone())?;
    
    if let Ok(target_canon) = std::fs::canonicalize(&path) {
        config.music_folders.retain(|p| {
             if let Ok(p_canon) = std::fs::canonicalize(p) {
                 p_canon != target_canon
             } else {
                 true
             }
        });
    } else {
         config.music_folders.retain(|p| p != &path);
    }
    
    save_config(app, config.clone())?;
    Ok(config.music_folders)
}

#[tauri::command]
async fn scan_music_library(path: String) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_music_library_blocking(path))
        .await
        .map_err(|e| e.to_string())?
}

fn to_unix_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn get_file_stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok().map(to_unix_seconds).unwrap_or(0);
    Some((modified, meta.len()))
}

fn parse_track_metadata(entry_path: &Path, folder_id: Option<String>) -> Track {
    let entry_path_str = entry_path.to_string_lossy().to_string();

    const MAX_METADATA_PARSE_FILE_SIZE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
    if let Ok(meta) = std::fs::metadata(entry_path) {
        if meta.len() > MAX_METADATA_PARSE_FILE_SIZE_BYTES {
            return Track {
                id: entry_path_str.clone(),
                canonical_id: entry_path_str.clone(),
                title: entry_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                artist: "Unknown".to_string(),
                album: "Unknown".to_string(),
                duration: 0,
                cover_url: None,
                audio_url: entry_path_str,
                folder_id,
                source: "local".to_string(),
            };
        }
    }

    let parsed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        Probe::open(entry_path)
            .map_err(|e| e.to_string())
            .and_then(|p| p.read().map_err(|e| e.to_string()))
    }));

    let tagged_file = match parsed {
        Ok(Ok(f)) => Ok(f),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("panic while parsing metadata".to_string()),
    };

    match tagged_file {
        Ok(tagged_file) => {
            let tag = tagged_file.primary_tag();
            let title = entry_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let artist = tag
                .and_then(|t| t.artist().map(|s| s.to_string()))
                .unwrap_or("Unknown Artist".to_string());
            let album = tag
                .and_then(|t| t.album().map(|s| s.to_string()))
                .unwrap_or("Unknown Album".to_string());
            let duration = tagged_file.properties().duration().as_secs();
            Track {
                id: entry_path_str.clone(),
                canonical_id: entry_path_str.clone(),
                title,
                artist,
                album,
                duration,
                cover_url: None,
                audio_url: entry_path_str,
                folder_id,
                source: "local".to_string(),
            }
        }
        Err(e) => {
            eprintln!("Error reading file {:?}: {}", entry_path, e);
            Track {
                id: entry_path_str.clone(),
                canonical_id: entry_path_str.clone(),
                title: entry_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string(),
                artist: "Unknown".to_string(),
                album: "Unknown".to_string(),
                duration: 0,
                cover_url: None,
                audio_url: entry_path_str,
                folder_id,
                source: "local".to_string(),
            }
        }
    }
}

fn scan_music_library_blocking(path: String) -> Result<ScanResult, String> {
    let root_path_buf = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let root_path = root_path_buf.as_path();
    let root_path_key = root_path.to_string_lossy().to_string().to_lowercase();

    let mut cached_tracks = {
        let mut guard = SCAN_CACHE.lock().map_err(|_| "cache lock poisoned".to_string())?;
        std::mem::take(
            &mut guard
                .entry(root_path_key.clone())
                .or_default()
                .tracks,
        )
    };

    let mut tracks = Vec::new();
    let mut folders = Vec::new();
    let mut folder_map: HashMap<String, String> = HashMap::new();
    let mut folder_index_by_id: HashMap<String, usize> = HashMap::new();
    let mut hasher = DefaultHasher::new();
    let mut seen_tracks: HashSet<String> = HashSet::new();

    folder_map.insert(root_path_key.clone(), root_path.to_string_lossy().to_string());

    for entry in WalkDir::new(&root_path_buf)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        let entry_path_str = entry_path.to_string_lossy().to_string();
        let entry_path_key = entry_path_str.to_lowercase();

        if entry_path.is_dir() {
            if entry_path == root_path {
                continue;
            }

            let rel = match entry_path.strip_prefix(root_path) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let depth = rel.components().count();

            let parent_path = match entry_path.parent() {
                Some(p) => p,
                None => continue,
            };
            let parent_path_key = parent_path.to_string_lossy().to_string().to_lowercase();

            let parent_id = if depth == 1 {
                None
            } else {
                folder_map.get(&parent_path_key).cloned()
            };

            let id = entry_path_str.clone();
            let name = entry_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            folders.push(MusicFolder {
                id: id.clone(),
                parent_id,
                name,
                path: entry_path_str.clone(),
                track_count: 0,
                source: "local".to_string(),
            });
            folder_index_by_id.insert(id.clone(), folders.len() - 1);
            folder_map.insert(entry_path_key.clone(), id);

            entry_path_key.hash(&mut hasher);
            if let Ok(meta) = std::fs::metadata(entry_path) {
                let modified = meta.modified().ok().map(to_unix_seconds).unwrap_or(0);
                modified.hash(&mut hasher);
            }
        } else if entry_path.is_file() {
            let extension = match entry_path.extension() {
                Some(e) => e,
                None => continue,
            };
            let ext = extension.to_string_lossy().to_lowercase();
            if !["mp3", "wav", "ogg", "flac", "m4a", "aac"].contains(&ext.as_str()) {
                continue;
            }

            let (modified, size) = match get_file_stamp(entry_path) {
                Some(s) => s,
                None => continue,
            };

            entry_path_key.hash(&mut hasher);
            modified.hash(&mut hasher);
            size.hash(&mut hasher);

            let parent_path = match entry_path.parent() {
                Some(p) => p,
                None => continue,
            };
            let parent_path_key = parent_path.to_string_lossy().to_string().to_lowercase();
            let folder_id = match parent_path.strip_prefix(root_path) {
                Ok(r) if r.components().count() == 0 => None,
                Ok(_) => folder_map.get(&parent_path_key).cloned(),
                Err(_) => None,
            };

            if let Some(fid) = &folder_id {
                if let Some(idx) = folder_index_by_id.get(fid).copied() {
                    if let Some(folder) = folders.get_mut(idx) {
                        folder.track_count += 1;
                    }
                }
            }

            let mut track = if let Some(cached) = cached_tracks.get(&entry_path_str) {
                if cached.modified == modified && cached.size == size {
                    let mut t = cached.track.clone();
                    t.folder_id = folder_id.clone();
                    t
                } else {
                    parse_track_metadata(entry_path, folder_id.clone())
                }
            } else {
                parse_track_metadata(entry_path, folder_id.clone())
            };

            track.cover_url = None;

            seen_tracks.insert(entry_path_str.clone());
            cached_tracks.insert(
                entry_path_str.clone(),
                CachedTrack {
                    track: track.clone(),
                    modified,
                    size,
                },
            );
            tracks.push(track);
        }
    }

    let revision = format!("{:016x}", hasher.finish());
    cached_tracks.retain(|path, _| seen_tracks.contains(path));

    {
        let mut guard = SCAN_CACHE.lock().map_err(|_| "cache lock poisoned".to_string())?;
        guard
            .entry(root_path_key)
            .or_default()
            .tracks = cached_tracks;
    }

    Ok(ScanResult {
        tracks,
        folders,
        revision,
    })
}

#[tauri::command]
fn get_cover_art(path: String) -> Result<Option<String>, String> {
    let Some(cover) = extract_cover_bytes(&path)? else {
        return Ok(None);
    };
    let encoded = BASE64_STANDARD.encode(&cover.bytes);
    Ok(Some(format!("data:{};base64,{}", cover.mime, encoded)))
}

#[tauri::command]
fn cover_server_register(path: String) -> Result<Option<String>, String> {
    if path.trim().is_empty() {
        return Ok(None);
    }
    let Some(cover) = extract_cover_bytes(&path)? else {
        return Ok(None);
    };

    let server = ensure_cover_server()?;
    let id = {
        let digest = Sha256::digest(path.as_bytes());
        URL_SAFE_NO_PAD.encode(digest)
    };
    {
        let mut map = server.entries.lock().map_err(|_| "cover server cache poisoned".to_string())?;
        map.insert(id.clone(), cover);
    }
    Ok(Some(format!("{}/cover/{}", server.base_url, id)))
}

#[tauri::command]
async fn navidrome_create_server(
    name: String,
    base_url: String,
    username: String,
    password: Option<String>,
    api_key: Option<String>,
) -> Result<NavidromeServerConfig, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let has_api_key = api_key.as_ref().is_some_and(|k| !k.trim().is_empty());
    let (token, salt) = if has_api_key {
        (String::new(), String::new())
    } else {
        let password = password.ok_or_else(|| "Password is required".to_string())?;
        let salt = uuid::Uuid::new_v4().simple().to_string();
        let token_input = format!("{}{}", password, salt);
        let token = format!("{:x}", md5::compute(token_input));
        (token, salt)
    };

    let server = NavidromeServerConfig {
        id,
        name,
        base_url,
        username,
        token,
        salt,
        api_key,
        enabled: true,
    };

    let _ = navidrome::ping(&server).await?;
    Ok(server)
}

#[tauri::command]
async fn navidrome_test_connection(app: tauri::AppHandle, server_id: String) -> Result<(), String> {
    let config = load_config(app)?;
    let server = config
        .navidrome_servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| "Navidrome server not found".to_string())?;
    let _ = navidrome::ping(server).await?;
    Ok(())
}

#[tauri::command]
async fn navidrome_scan_library(app: tauri::AppHandle, server_id: String) -> Result<ScanResult, String> {
    let config = load_config(app)?;
    let server = config
        .navidrome_servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| "Navidrome server not found".to_string())?;
    if !server.enabled {
        return Ok(ScanResult {
            tracks: Vec::new(),
            folders: Vec::new(),
            revision: "disabled".to_string(),
        });
    }
    navidrome::scan_library(server).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(rust_analyzer))]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
            || std::env::var("XDG_SESSION_TYPE")
                .ok()
                .is_some_and(|v| v.eq_ignore_ascii_case("wayland"));

        let is_appimage = std::env::var_os("APPIMAGE").is_some();
        if is_appimage && std::env::var_os("WEBKIT_DISABLE_SANDBOX").is_none() {
            std::env::set_var("WEBKIT_DISABLE_SANDBOX", "1");
        }

        if is_wayland && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if is_wayland && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if is_wayland && std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    tauri::Builder::default()
        .manage(DiscordRpcState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_music_library,
            get_cover_art,
            cover_server_register,
            save_config,
            load_config,
            load_color_ini,
            load_color_themes,
            discord_rpc_connect,
            discord_rpc_set_activity,
            discord_rpc_clear,
            minimize_window,
            close_window,
            set_window_decorations,
            exit_app,
            add_music_folder,
            prune_music_folders,
            remove_music_folder,
            create_folder,
            delete_track,
            show_in_explorer,
            navidrome_create_server,
            navidrome_test_connection,
            navidrome_scan_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(rust_analyzer)]
pub fn run() {}
