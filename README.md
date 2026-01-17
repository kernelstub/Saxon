<br />
<div align="center">
  <h1 align="center">Saxon</h1>
  
  <img src="https://github.com/user-attachments/assets/1a2d0990-651d-47d5-bc11-235767fe0a0e" alt="Saxon Logo" width="1231" />
  <p align="center">
    A modern, high-performance, and cross-platform music player
    <br />
    <br />
    <a href="#download">Download</a>
    ·
    <a href="#features">Features</a>
    ·
    <a href="#installation">Installation</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about">About</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#download">Download</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#tech-stack">Tech Stack</a></li>
  </ol>
</details>

<h1 id="about">About</h1>

- Modern music player engineered with Tauri, React, and Rust
- Lightweight footprint compared to Electron alternatives
- Cross-platform support for Windows and Linux
- Responsive, dark-themed UI with frameless design

<h1 id="features">Features</h1>

- **Audio Engine**:
  - 10-Band Parametric Equalizer with presets (Bass Boost, Flat, Classical, etc.)
  - Crossfade support with customizable duration (0-12s)
  - Volume Normalization using dynamic range compression
  - Gapless playback architecture

- **Library Management**:
  - Recursive directory scanning for deep folder structures
  - Real-time search by title, artist, or album
  - Favorites collection for quick access
  - Recently Played tracking
  - Context menu integration (Show in Explorer, Delete)

- **User Interface**:
  - Minimalist, dark-themed aesthetic
  - Custom window controls (minimize, close)
  - Draggable header region
  - Adaptive responsive layout

<h1 id="download">Download</h1>

- Pre-compiled binaries available on the [Releases](https://github.com/kernelstub/Saxon/releases) page
- Windows: `.exe` installer
- Linux: `.deb` package and AppImage

<h1 id="development">Development</h1>

- **Prerequisites**:
  - Node.js v16+ (LTS)
  - Rust (stable)
  - Build Tools:
    - Windows: Visual Studio C++ Build Tools
    - Linux: `libwebkit2gtk-4.1-dev`, `build-essential`, etc.

- **Setup**:
  - Clone: `git clone https://github.com/kernelstub/Saxon.git`
  - Install: `npm install`
  - Run Dev: `npm run tauri dev`

- **Build**:
  - Windows: `npm run tauri build` (Output: `src-tauri/target/release/bundle/nsis/`)
  - Linux: `npm run tauri build` (Output: `src-tauri/target/release/bundle/deb/`)

<h1 id="tech-stack">Tech Stack</h1>

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons
- **Backend**: Rust (Tauri 2.x)
- **Build Tool**: Vite
