# Changelog

## 2026-01-22

### Stability
- Fixed local playback crashes by streaming from the filesystem instead of reading entire audio files into memory.
- Hardened library scanning and cover art extraction to avoid crashes from huge/corrupted metadata.
- Fixed Wayland rendering issues by sandboxing X11 usage inside the Tauri window.

### Platform
- Improved Windows dev startup reliability by using `127.0.0.1` instead of `localhost`.
- Added WebKitGTK/Wayland startup fallbacks to reduce blank window / "can't reach the page" failures.

### Discord Rich Presence
- Improved presence formatting: multiple artists are now displayed as `Artist1, Artist2` instead of `Artist1/Artist2`.
- Removed album display from the presence.
- Removed extra hover text that caused duplicated lines in the presence.
- Switched Rich Presence image handling to a static app asset key (`saxon`) instead of per-track external images.

### Covers & Queue
- Added a local cover art HTTP server so embedded covers can be served as `http://127.0.0.1:<port>/cover/<id>` URLs.
- Added a new backend command `cover_server_register(path)` to register a track’s embedded cover for HTTP serving.
- Updated queue screen to proactively request missing covers so images continue loading further down the queue.

### Documentation
- Added usage guide: `documentation/app/README.md`.
- Added theming guide: `documentation/theming/README.md`.

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

