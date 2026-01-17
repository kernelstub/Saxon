use base64::prelude::*;
use lofty::{Accessor, AudioFile, Probe, TaggedFileExt};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: u64,
    cover_url: Option<String>,
    audio_url: String,
    folder_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MusicFolder {
    id: String,
    parent_id: Option<String>,
    name: String,
    path: String,
    track_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    tracks: Vec<Track>,
    folders: Vec<MusicFolder>,
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

use std::collections::HashMap;

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
    let mut tracks = Vec::new();
    let mut folders = Vec::new();
    let mut folder_map: HashMap<String, String> = HashMap::new();

    let root_path_buf = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let root_path = root_path_buf.as_path();
    let root_id = root_path.to_string_lossy().to_string(); 
    
    let root_path_key = root_path.to_string_lossy().to_string().to_lowercase();
    
    folder_map.insert(root_path_key.clone(), root_id.clone());

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

            let parent_path = entry_path.parent().unwrap();
            let parent_path_key = parent_path.to_string_lossy().to_string().to_lowercase();
            
            let parent_id = if depth == 1 {
                None
            } else {
                folder_map.get(&parent_path_key).cloned()
            };
            
            let id = entry_path_str.clone();
            let name = entry_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            
            folders.push(MusicFolder {
                id: id.clone(),
                parent_id,
                name,
                path: entry_path_str.clone(),
                track_count: 0,
            });
            folder_map.insert(entry_path_key.clone(), id);
        } else if entry_path.is_file() {
            if let Some(extension) = entry_path.extension() {
                let ext = extension.to_string_lossy().to_lowercase();
                if ["mp3", "wav", "ogg", "flac", "m4a", "aac"].contains(&ext.as_str()) {
                    let parent_path = entry_path.parent().unwrap();
                    let parent_path_key = parent_path.to_string_lossy().to_string().to_lowercase();

                    let folder_id = match parent_path.strip_prefix(root_path) {
                        Ok(r) if r.components().count() == 0 => None,
                        Ok(_) => folder_map.get(&parent_path_key).cloned(),
                        Err(_) => None,
                    };

                    if let Some(fid) = &folder_id {
                        if let Some(folder) = folders.iter_mut().find(|f| f.id == *fid) {
                            folder.track_count += 1;
                        }
                    }

                    match Probe::open(&entry_path)
                        .map_err(|e| e.to_string())
                        .and_then(|p| p.read().map_err(|e| e.to_string()))
                    {
                        Ok(tagged_file) => {
                            let tag = tagged_file.primary_tag();
                            
                            let title = entry_path.file_stem()
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

                            let mut cover_url = None;
                            if let Some(tag) = tag {
                                if let Some(picture) = tag.pictures().first() {
                                    let mime = picture.mime_type().to_string();
                                    let encoded = BASE64_STANDARD.encode(picture.data());
                                    cover_url = Some(format!("data:{};base64,{}", mime, encoded));
                                }
                            }

                            tracks.push(Track {
                                id: entry_path.to_string_lossy().to_string(),
                                title,
                                artist,
                                album,
                                duration,
                                cover_url,
                                audio_url: entry_path.to_string_lossy().to_string(),
                                folder_id,
                            });
                        }
                        Err(e) => {
                            eprintln!("Error reading file {:?}: {}", entry_path, e);
                             tracks.push(Track {
                                id: entry_path.to_string_lossy().to_string(),
                                title: entry_path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                                artist: "Unknown".to_string(),
                                album: "Unknown".to_string(),
                                duration: 0,
                                cover_url: None,
                                audio_url: entry_path.to_string_lossy().to_string(),
                                folder_id,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(ScanResult { tracks, folders })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(rust_analyzer))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_music_library,
            save_config,
            load_config,
            add_music_folder,
            prune_music_folders,
            remove_music_folder,
            create_folder,
            delete_track,
            show_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(rust_analyzer)]
pub fn run() {}
