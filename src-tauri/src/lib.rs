use base64::prelude::*;
use lofty::{Accessor, AudioFile, Probe, TaggedFileExt};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

mod navidrome;

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
    navidrome_servers: Vec<NavidromeServerConfig>,
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
    const MAX_COVER_ART_BYTES: usize = 5 * 1024 * 1024;
    let tagged_file = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        Probe::open(Path::new(&path))
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
            let mime = picture.mime_type().to_string();
            let encoded = BASE64_STANDARD.encode(picture.data());
            return Ok(Some(format!("data:{};base64,{}", mime, encoded)));
        }
    }
    Ok(None)
}

#[tauri::command]
async fn navidrome_create_server(
    name: String,
    base_url: String,
    username: String,
    password: String,
) -> Result<NavidromeServerConfig, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let salt = uuid::Uuid::new_v4().simple().to_string();
    let token_input = format!("{}{}", password, salt);
    let token = format!("{:x}", md5::compute(token_input));

    let server = NavidromeServerConfig {
        id,
        name,
        base_url,
        username,
        token,
        salt,
        enabled: true,
    };

    navidrome::ping(&server).await?;
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
    navidrome::ping(server).await?;
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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_music_library,
            get_cover_art,
            save_config,
            load_config,
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
