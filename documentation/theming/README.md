# Theming Saxon

Saxon themes are driven by CSS custom properties (CSS variables). The app loads theme values from a `color.ini` file at startup, then applies them to the document root (`:root`) so Tailwind + UI components automatically pick them up.

## Where Themes Live

Themes are stored in the app config directory as:

- `color.ini` (theme definitions)
- `config.json` (includes the selected theme name)

`color.ini` is auto-created on first run with a `[default]` theme.

## Theme File Format (color.ini)

`color.ini` uses INI sections. Each section is a theme name, and each entry is `key=value`.

Example:

```ini
[default]
background=#0f0f0f
foreground=#f2f2f2
card=#141414
primary=#b3b3b3
radius=0.625rem

[oled]
background=#000000
card=#000000
border=#111111
sidebar=#000000
```

Rules:

- Section names become selectable themes in the Settings UI.
- Keys map to CSS variables, and values can be any valid CSS value:
  - Colors: `#RRGGBB`, `#RRGGBBAA`, `rgb(...)`, `hsl(...)`, `oklch(...)`, etc.
  - Sizes: `0.625rem`, `10px`, etc.

## How Themes Are Applied

At startup:

- The backend ensures `color.ini` exists (creates it if missing).
- The frontend loads all theme sections (and their order), picks the selected theme (falls back to `default`), and applies it by setting CSS variables on `document.documentElement`.

Notes:

- Switching themes in Settings updates the applied CSS variables immediately.
- Editing `color.ini` by hand currently requires restarting the app to reload the file contents (the app does not watch the file for changes).

## Creating Multiple Themes

To add more themes:

1. Open `color.ini`
2. Add a new section name like `[mytheme]`
3. Add any keys you want to override
4. Restart Saxon
5. Go to Settings → Theme and select your new theme

Themes do not need to specify every key. Any keys you omit will fall back to the default theme values defined in the app’s base CSS.

## Supported Keys (What Each One Changes)

These keys are applied as CSS variables named `--{key}` (for example `background` sets `--background`).

### Core Surfaces & Text

- `background`: App background (`bg-background`), main page backdrop
- `foreground`: Default text color (`text-foreground`)
- `card`: Card / panel backgrounds (`bg-card`)
- `card-foreground`: Text on cards (`text-card-foreground`)
- `popover`: Popover / dropdown backgrounds (`bg-popover`)
- `popover-foreground`: Text on popovers (`text-popover-foreground`)

### Accents & State Colors

- `primary`: Primary accent (primary buttons, highlights)
- `primary-foreground`: Text/icons on primary surfaces
- `secondary`: Secondary surface color (subtle backgrounds)
- `secondary-foreground`: Text/icons on secondary surfaces
- `muted`: Muted surface color (quiet UI regions)
- `muted-foreground`: Muted text (timestamps, helper text)
- `accent`: Accent surface color (hover surfaces, emphasis blocks)
- `accent-foreground`: Text/icons on accent surfaces
- `destructive`: Destructive/danger color (delete actions, errors)
- `destructive-foreground`: Text/icons on destructive surfaces

### Borders, Inputs, Focus

- `border`: Border color (`border-border`)
- `input`: Input background/border tone (`bg-input` / input styling)
- `ring`: Focus ring color (`outline-ring`)

### Charts (If Used)

- `chart-1` … `chart-5`: Reserved chart palette tokens

### Shape

- `radius`: Base border radius. Components derive `sm/md/lg/xl` from this value.

### Sidebar (Navigation)

- `sidebar`: Sidebar background
- `sidebar-foreground`: Sidebar text/icons
- `sidebar-primary`: Sidebar primary accent (selected/primary actions)
- `sidebar-primary-foreground`: Text/icons on sidebar primary
- `sidebar-accent`: Sidebar hover/secondary surfaces
- `sidebar-accent-foreground`: Text/icons on sidebar accent
- `sidebar-border`: Sidebar border color
- `sidebar-ring`: Sidebar focus ring color

### Scrollbars

- `scrollbar-thumb`: Scrollbar thumb color (supports alpha, e.g. `#6666664D`)
- `scrollbar-thumb-hover`: Thumb hover color

### Range / Slider Styling

- `range-track`: Track color for native range inputs (and range-like UI)
- `range-thumb`: Thumb color for native range inputs

## Tips

- If you want an “OLED” look: set `background`, `card`, and `sidebar` to `#000000` and use slightly lighter `border`.
- Prefer using alpha for subtle UI: for example `#ffffff0f` (hex with transparency).
- Keep contrast high enough for readability: `foreground` vs `background`, and `muted-foreground` vs `muted`.

