# Recent Edits

A sidebar panel for Obsidian that shows files modified in the last *N* days, grouped by calendar day. Marks files edited from outside Obsidian — filesystem writes, sync from another device, plugins that write programmatically — with a configurable indicator dot.

![Recent Edits panel](<assets/Recent Edits Screenshot.png>)

## Why this exists

Most **Recent Files** plugins for Obsidian show recently *opened* files, not recently *modified* ones. As I use my vault together with AI tools, I thought it would be useful to see recently modified files and distinguish between edits I've made in Obsidian and those made by the file system. This is useful when using:

- An external editor or script writing through the filesystem
- AI assistants editing notes via filesystem APIs

Recent Edits closes that gap. It shows what changed, when it changed, and visually flags edits that came from outside Obsidian's editor.

## Features

- Files modified in the last 7 days (configurable, 1–90 days), grouped by calendar day
- Day headers labelled `Today` / `Yesterday` / `YYYY-MM-DD (Ddd)`, sorted most recent first
- Configurable indicator dot for edits that came from outside Obsidian's editor
- "Background folders" toggle: hide noisy folders by default, reveal inline via toggle
- "Excluded folders" to permanently hide certain edits
- Optional hover preview (uses the Page Preview core plugin)
- Includes `.md`, `.canvas`, and `.base` files

## Install

1. In Obsidian: Settings → Community plugins.
2. If Restricted mode is on, turn it off.
3. Click **Browse**, search for `Recent Edits`, and click **Install**.
4. Enable **Recent Edits** in the Community plugins list.
5. Click the clock/history ribbon icon, or run **Open Recent Edits panel** from the command palette.

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| Lookback days | number | `7` | How many days back to include. Range 1–90. |
| Hover preview | toggle | off | Show Obsidian's page preview popup on hover. Requires the Page Preview core plugin. |
| External edit indicator color | color | `#D97757` | Color of the dot shown next to externally-edited files. |
| Background folders | folder list | `[]` | Hidden by default; revealed by the per-day-header toggle. Useful for files that update often but you only check occasionally. |
| Excluded folders | folder list | `[]` | Hidden completely. Dot-prefixed folders (`.obsidian`, `.trash`) are always excluded regardless. |

## How the external-edit indicator works

The plugin listens for Obsidian's `editor-change` event (fires when a file is edited inside Obsidian) and the vault's `create`/`modify` events (fire for any change, including writes from outside Obsidian). When a file is created or modified without a recent matching `editor-change`, it's classified as an external edit.

### Potential Limitations

The external-edit status is meant to be an indication. I've tried to make it accurate for my setup, but variations in setup or changes in the future mean you should treat it as an indicator rather than a perfect signal. It could mistake:

- Edits arriving via Obsidian Sync from another device.
- Writes from other plugins (Templater, Daily Notes, etc.).
- Files modified before the plugin was installed (these stay unclassified until the next time they're touched).

## Support

If Recent Edits is useful to you, consider buying me a coffee:

<a href='https://ko-fi.com/S6S6Z9TE1' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi2.png?v=3' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

## License

MIT — see [LICENSE](LICENSE).
