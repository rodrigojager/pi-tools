# pi-sidebar-tui

This is Rodrigo's compatibility fork of
[bi0h4z4rd88/pi-sidebar-tui](https://github.com/bi0h4z4rd88/pi-sidebar-tui), based on
upstream 1.7.4. Version **1.7.5-rodrigo.1** fixes the Pi 0.86.1 crash when switching
between regular/fullscreen TUI mode and reloading extensions. It also keeps the
sidebar attached to the active renderer. The original author and history are
preserved.

OpenCode-style sidebar TUI extension for [pi coding agent](https://github.com/earendil-works/pi).

Displays a real-time sidebar panel inside the pi terminal UI showing session metrics, todo tracking, workspace status, and connected MCP servers — inspired by [OpenCode](https://github.com/atanunny/opencode) sidebar.

## Features

### Session Panel
- Session title (auto-inferred from first user message with LLM fallback, or manually set)
- Session elapsed time (updated every 30 seconds)
- Active tool indicator with live elapsed timer
- Current model name with thinking level (`think:high`, `think:medium`, etc.)
- Context window usage: `tokens / max_window (pct%)` — fill bar colored by usage: green <50%, yellow 50–80%, red >80%
- Context estimate: `left ≈Nt` — turns remaining until the window fills at recent growth rate (`∞` when flat, `—` until enough data); colored muted ≥20t / accent 5–19t / warning red <5t
- Auto-compact status indicator
- Token input/output totals + session cost
- Cache hit percentage + turn count
- Live tokens-per-second (tok/s) via 2-second sliding window
- Session ID display
- Theme-aware colors (delegates to pi Theme API when available)

### MCP Servers Panel
- Connected MCP server status with connection indicators
- Tool count per server (direct/total)
- Token estimate per server

### Todos Panel
- Parses todo items from tool calls (`todo` tool)
- Status glyphs: `○` pending, `◐` in progress, `✓` completed
- Progress counter: `Todos (2/5)`
- Sub-action annotations for in-progress items

### Workspace Panel
- Git branch with ahead/untracked counts
- Dirty file listing with diff stats (+N/-N)
- Current working directory at bottom of sidebar
- Auto-refreshes on write operations (write/edit/bash/computer tools)

## Installation

```bash
pi install https://github.com/rodrigojager/pi-sidebar-tui
```

The extension auto-registers via the `"pi"` field in `package.json`.

If the npm edition is already installed, remove it before installing this fork
so the sidebar is loaded only once:

```sh
pi remove npm:pi-sidebar-tui
pi install https://github.com/rodrigojager/pi-sidebar-tui
```

If using a temporary local copy instead, run `pi list` and remove that copy using
its exact source path before installing the GitHub version. Restart Pi afterward.

Update this fork with:

```sh
pi update https://github.com/rodrigojager/pi-sidebar-tui
```

This release is distributed through GitHub. Installing `npm:pi-sidebar-tui`
selects the upstream npm edition, which does not contain this fork's fix.

## Usage

The sidebar activates automatically when a session starts. Toggle visibility with:

```
/sidebar-tui on       # Enable sidebar
/sidebar-tui off      # Disable sidebar
/sidebar-tui width 45 # Set sidebar width (10-120)

Ctrl+Shift+T           # Toggle sidebar on/off (rebind in ~/.pi/agent/keybindings.json)
```

Set custom session title:

```
/session-title "My feature implementation"
```

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PI_SIDEBAR_BG` | *(unset)* | Paint the sidebar with an opaque `#rrggbb` background. Unset (default) leaves the terminal background untouched so terminal transparency shows through. Set e.g. `PI_SIDEBAR_BG="#000000"` to hide scroll flash on opaque terminals. |

## Requirements

- [pi coding agent](https://github.com/earendil-works/pi) >= 0.74.0
- [pi-tui](https://github.com/earendil-works/pi) >= 0.74.0

## Architecture

```
pi-sidebar-tui/
├── index.ts              # Extension entry point, event handlers, state management
├── sidebar.ts            # Main sidebar renderer (composes all panels)
├── compositor.ts         # Terminal compositor for right-column layout
├── colors.ts             # ANSI color helpers, formatting utilities
├── types.ts              # TypeScript type definitions
├── mcp.ts                # MCP server discovery and status
├── workspace.ts          # Git workspace state tracking
├── panels/
│   ├── session.ts        # Session metrics panel
│   ├── todos.ts          # Todo tracking panel
│   ├── workspace.ts      # Git workspace status panel
│   └── mcp.ts            # MCP server status panel
├── tests/
│   ├── panels.test.ts    # Panel rendering tests
│   └── sidebar.test.ts   # Sidebar rendering tests
└── package.json
```

## How It Works

The extension hooks into pi's event system (`session_start`, `tool_call`, `message_end`, `turn_end`, etc.) to track state and renders a right-column sidebar using a custom `SidebarCompositor` that:

1. Narrows `terminal.columns` so pi renders main content in the left portion
2. Paints the sidebar in the rightmost columns after each pi render cycle
3. Uses synchronized output (`\x1b[?2026h`) to prevent rendering artifacts
4. Saves/restores cursor position (`DECSC`/`DECRC`) around paint

## Development

```bash
npm install
npm test
```

## Fork releases

Update `package.json` and `CHANGELOG.md`, commit, and push the GitHub branch/tag.
The package is marked private to prevent accidentally publishing this fork under
the upstream npm package name. Runtime loading through Pi's Git installer still
works. The development dependencies are pinned to Pi 0.86.1 for regression checks.

## License

MIT
