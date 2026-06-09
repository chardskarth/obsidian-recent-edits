# Implementation Plan: Frontmatter-Based Recent Edits

## Overview

Replace the event-based edit tracking mechanism with YAML frontmatter-based tracking using `lastUpdatedDateTimes` and `createdDateTime` fields.

---

## Files to Modify

1. **`main.ts`** — Major refactoring
2. **`styles.css`** — Change orange dot to green dot

---

## Data Model Changes

### New Interfaces

```typescript
interface FileEntry {
  file: TFile;
  timestamp: number;
  isCreatedDate: boolean;
}

interface DayGroup {
  key: string;
  date: Date;
  files: FileEntry[];
}
```

### Remove from Plugin Class

- Properties: `editSources`, `editTimes`, `dismissedAt`, `editorChangeTimes`, `recentFileOpens`, `saveDataTimer`
- Type: `EditSource`

### Remove Constants

- `EDITOR_CHANGE_WINDOW_MS`
- `ACTIVE_LOCAL_FILE_WINDOW_MS`
- `EXTERNAL_SYNC_GUARD_MS`
- `FILE_OPEN_WINDOW_MS`
- `CREATE_CLASSIFY_DELAY_MS`
- `HOVER_SOURCE`

### Remove Methods

- `classifyEdit()`
- `isExternalEdit()`
- `isDismissed()`
- `persistData()`
- `scheduleSaveData()`
- `reloadEditMetadata()`

### Remove Event Listeners

- `editor-change`
- `file-open`
- `create`
- `modify`
- `delete`
- `rename`
- `active-leaf-change`

### Remove Settings

- `externalEditColor` from `RecentEditsSettings` and `DEFAULT_SETTINGS`

---

## New Methods

### `parseFrontmatterDateTime(raw: string): number`

Parses datetime strings:
- `"2026-06-08 16:51:59"` (24h format)
- `"2026-06-05 11:35 AM"` (12h format)
- Returns timestamp in ms

### `getFrontmatterDates(file: TFile): { created: number | null, updates: number[] }`

- Reads `lastUpdatedDateTimes` (array of strings) → `updates[]`
- Reads `createdDateTime` or `createddatetime` (case-insensitive) → `created`
- Uses `app.metadataCache.getFileCache(file)?.frontmatter`

### `getFileEntries(file: TFile): FileEntry[]`

1. Get `{ created, updates }` from `getFrontmatterDates()`
2. If both null, return empty array
3. Build unique date set from updates + created date
4. For each date, find the most recent `updates` entry for that date, or use `created` timestamp if it's the creation date
5. Mark `isCreatedDate: true` when date matches created date
6. Sort by timestamp descending

---

## Modified Methods

### `getRecentFiles()` → returns `DayGroup[]`

1. Get all vault files with supported extensions
2. For each file, call `getFileEntries(file)`
3. Skip if empty (no frontmatter data)
4. Filter by excluded/background folders
5. Filter by lookback window (using each entry's timestamp)
6. Group entries by date key
7. Sort groups by date descending, entries within groups by timestamp descending

### `renderFileRow(parent, entry: FileEntry)`

- Use `entry.file` instead of `file` directly
- Add `is-new-file` CSS class when `entry.isCreatedDate` is true
- Display time from `entry.timestamp`

### `dismissFile(file: TFile)`

Replace with:

```typescript
dismissFile(file: TFile) {
  new Notice("Not yet implemented");
}
```

### `loadSettings()`

- Remove `_editSources`, `_editTimes`, `_dismissedAt` loading

---

## CSS Changes (`styles.css`)

### Rename

```css
/* Before */
.recent-edits-row.is-external-edit .recent-edits-row-name::before

/* After */
.recent-edits-row.is-new-file .recent-edits-row-name::before
```

### Change Color

```css
/* Before */
background-color: var(--recent-edits-dot-color, #D97757);

/* After */
background-color: var(--text-success, #4CAF50);
```

---

## Settings UI Changes

Remove "External edit indicator color" setting entirely.

### Keep

- Lookback days
- Hover preview
- Copy path affordance
- Background folders
- Excluded folders

---

## Example Behavior

File with:

```yaml
createdDateTime: 2026-06-05 11:35 AM
lastUpdatedDateTimes:
  - 2026-06-08 16:51:59
  - 2026-06-05 19:04:46
```

| Group | Timestamp | Green Dot |
|-------|-----------|-----------|
| Jun 5 | 19:04:46 | ✓ (matches createdDateTime) |
| Jun 8 | 16:51:59 | ✗ |

---

## Summary

| Feature | Before | After |
|---------|--------|-------|
| Edit detection | Vault events + heuristics | YAML frontmatter `lastUpdatedDateTimes` |
| Fallback | `file.stat.mtime` | `createdDateTime` frontmatter |
| No data | Show anyway | Don't show file |
| Green dot | N/A | Created date matches group date |
| Orange dot | External edits | Removed |
| Dismiss | Stores in data.json | Placeholder notice |
| Persistence | data.json | None |
| File entries | Once per file | Multiple (one per date group) |
