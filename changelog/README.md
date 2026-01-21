# Changelog

## 2026-01-21

### Navidrome (Subsonic)
- Added Navidrome server support (Subsonic REST API): connect, test, enable/disable, and persist servers in Settings.
- Added Navidrome library browsing with an organized root: All Tracks, Artists, and Playlists.
- Added playlist browsing and playback (playlist entries are handled correctly for favorites and recents).
- Added Navidrome streaming playback via Subsonic `stream` URLs and cover art via `getCoverArt`.

## 2026-01-18

### Performance
- Added a backend scan cache so repeated refreshes reuse per-file metadata when files are unchanged.
- Added a library revision hash so the frontend can skip UI updates when the library did not change.
- Moved cover art extraction out of the scan path and into a dedicated on-demand command.
- Added virtualized rendering for large track lists so only visible rows are mounted.
- Reduced refresh jank with in-flight refresh throttling, hidden-tab skipping, and transition-based state updates.
- Fixed hover flicker during playback by memoizing heavy derived arrays so TrackList does not rerender on every audio time update.

### Backend (Tauri/Rust)
- `scan_music_library` now runs as a blocking task on the Tauri async runtime and caches track metadata by (mtime, size).
- New command: `get_cover_art(path)` returns an optional `data:<mime>;base64,...` URL.

### Frontend (React)
- Track list virtualization implemented inside TrackList.
- Covers are requested lazily for visible tracks and cached in-memory.

