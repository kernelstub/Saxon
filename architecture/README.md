# Architecture

## Overview
Saxon is a desktop music player built with a Tauri (Rust) backend and a React + TypeScript frontend.

- The frontend is responsible for UI rendering, playback controls, and browser-based audio processing.
- The backend is responsible for filesystem access, library scanning, tag parsing, config persistence, and OS integration.

## High-Level Data Flow
1. The frontend loads persisted settings from the backend config.
2. The frontend requests library scans for each configured music root folder.
3. The backend returns tracks and folders plus a revision identifier.
4. The frontend merges results, renders folders and tracks, and plays audio using the file path provided by the backend scan.
5. Periodic refresh repeats the scan, but the UI update is skipped when the revision is unchanged.

## Frontend

### Entry and Composition
- Main UI and state orchestration lives in [App.tsx](file:///c:/Users/wwwge/Desktop/Saxon/src/App.tsx).
- The primary layout is Sidebar + Header + Main Content + PlayerControls.

### State Ownership
App owns the main application state:
- Library: tracks, folders, selected folder, view mode, search query
- Playback: currentTrack and PlayerState
- User data: favorites, recent tracks
- Audio settings: EQ enabled/preset/values, crossfade, normalization

### Library Rendering
The library view is rendered by [TrackList](file:///c:/Users/wwwge/Desktop/Saxon/src/components/track-list.tsx).

Key behaviors:
- Folder browsing uses `selectedFolder` and the folder tree produced by the backend scan.
- Track list rendering is virtualized so large libraries do not mount thousands of rows at once.
- Covers are fetched lazily for visible rows and cached, to avoid heavy work during scans.

### Playback
Playback is implemented in the frontend using an `HTMLAudioElement` plus an optional WebAudio graph:
- File bytes are read via the Tauri fs plugin and converted to an object URL for playback.
- The WebAudio graph (when EQ and/or normalization are enabled) uses:
  - MediaElementSource -> 10 biquad filters -> compressor -> master gain -> destination
- Crossfade is implemented by ramping volume (master gain when WebAudio is active, otherwise the audio element volume).

### Performance Strategy
Frontend performance is primarily controlled by:
- Skipping refresh updates when the backend revision is unchanged.
- Using `startTransition` for large state updates so UI stays responsive.
- Virtualizing the TrackList to reduce DOM and reconciliation work.
- Memoizing derived arrays (filter/sort/favorites array) so TrackList does not rerender due to unrelated state changes.

## Backend (Tauri / Rust)

### Runtime
The backend lives under [src-tauri](file:///c:/Users/wwwge/Desktop/Saxon/src-tauri) and exposes commands to the frontend via `invoke`.

The command implementations are in [lib.rs](file:///c:/Users/wwwge/Desktop/Saxon/src-tauri/src/lib.rs).

### Library Scanning
`scan_music_library(path)` performs a recursive walk starting at the provided root folder and returns:
- `tracks`: a flat list of audio files (with metadata)
- `folders`: a flat list of directories (with parentId relationships and track counts)
- `revision`: a stable identifier that changes when the on-disk library changes

Metadata extraction:
- Audio tags are parsed with `lofty`.
- Cover art is intentionally not embedded in the scan result; it is fetched separately on demand.

Caching:
- The backend caches per-track metadata keyed by file path and validated by (modified time, size).
- On refresh, unchanged tracks reuse cached metadata, minimizing repeated tag parsing cost.
- Deleted files are removed from the cache.

### Cover Art
`get_cover_art(path)` parses tags and returns the first embedded picture as a data URL.

This is used as a lazy path to avoid doing base64 encoding for every track during scan.

### Config Persistence
Config is stored as JSON in the Tauri app config directory:
- `load_config` reads the config file if present and falls back to defaults.
- `save_config` writes the full config.
- `add_music_folder`, `remove_music_folder`, and `prune_music_folders` maintain a minimal set of root folders.

### OS Integration
- `show_in_explorer` selects a file in the system file manager (Explorer/Finder/etc.).
- `delete_track` deletes a file from disk.

## Shared Data Model
Frontend types are defined in [types.ts](file:///c:/Users/wwwge/Desktop/Saxon/src/lib/types.ts) and mirrored in Rust structs.

Important fields:
- Track identity is currently based on the file path (id and audioUrl).
- Folder identity is the folder path (id and path), with `parentId` derived from the directory tree.

## Notes and Tradeoffs
- Path-based IDs are simple and fast, but moving files changes identity (favorites/recent tracking is path-based).
- Lazy cover loading improves scan speed but adds incremental cover fetch work while scrolling; caching keeps it bounded.

