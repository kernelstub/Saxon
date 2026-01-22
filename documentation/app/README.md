# Using Saxon

Saxon is a desktop music player built with a local library scanner and optional Navidrome (Subsonic) streaming support.

## Main Screens

Use the sidebar to switch between:

- **Library**: Browse folders and tracks from your configured sources.
- **Now Playing**: Large cover view + full playback controls.
- **Queue**: What will play next (manual queue + context queue).
- **Favorites**: Tracks you’ve starred.
- **Recent**: Tracks you played recently.

## Building Your Library

### Add Local Music Folders

1. Open **Settings**
2. Under **Library**, click **Add Folder**
3. Pick a folder that contains music files

Saxon scans folders recursively and builds a library tree. Cover art is extracted from embedded tags when available.

### Add a Navidrome Server

1. Open **Settings**
2. Find the **Navidrome** section
3. Enter:
   - Base URL (example: `https://navidrome.example.com`)
   - Username
   - Password (or OpenSubsonic API key if you use one)
4. Save / add the server
5. Use **Test** to confirm the connection

Enabled servers appear in the library alongside local folders.

## Playing Music

### Start Playback

You can start playback by:

- Clicking any track in **Library**
- Selecting a track from the **Search** dropdown
- Clicking a track in **Queue**

### Playback Controls

Controls are available on:

- The **Now Playing** screen (full controls)
- The bottom **player bar** when you’re not on Now Playing

Typical actions:

- Play/Pause
- Next/Previous
- Seek (scrub the progress bar)
- Volume + Mute
- Shuffle
- Repeat (off / all / one)

## Queue Behavior

Saxon maintains two concepts:

- **Manual queue**: tracks you explicitly add (these play first)
- **Context queue**: the current browsing context (for example, a folder, favorites, recent, or artist view)

In the Queue screen you can remove tracks from the manual/context queues.

## Search

Use the search box in the header to filter by:

- Title
- Artist
- Album

Selecting a result plays it immediately.

## Favorites & Recent

- **Favorite** a track using the heart action in the library list.
- **Favorites** view shows your saved favorites.
- **Recent** view shows tracks you’ve played recently.

## Artist View

Clicking an artist name (where supported) opens an **Artist** view that filters the library to that artist.

## Settings

### Audio (EQ, Crossfade, Normalize)

- **10-band EQ**: enable/disable and choose a preset or custom values
- **Crossfade**: set the transition duration between tracks
- **Normalize**: enables a compressor-based normalization for more consistent loudness

### Discord Rich Presence

When enabled, Saxon can show your current track in your Discord profile.

- Turn it on in **Settings → Discord Rich Presence**
- Use **Test** to verify your Discord client is receiving updates

Cover images in Rich Presence depend on what Discord accepts. Some sources (like Navidrome cover URLs) may display; embedded local cover art may not, depending on Discord client behavior.

### Theme

Saxon themes are driven by `color.ini`.

- Select a theme in **Settings → Theme**
- To create/edit themes, see: `documentation/theming/README.md`

### Window Controls

You can toggle showing minimize/close buttons in the header from **Settings → Window**.

