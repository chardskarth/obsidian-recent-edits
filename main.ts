import {
  App,
  FileSystemAdapter,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
} from "obsidian";

type PathCopyAffordance = "button" | "path-text" | "both";

interface RecentEditsSettings {
  excludedFolders: string[];
  backgroundFolders: string[];
  lookbackDays: number;
  enableHoverPreview: boolean;
  pathCopyAffordance: PathCopyAffordance;
}

const DEFAULT_SETTINGS: RecentEditsSettings = {
  excludedFolders: [],
  backgroundFolders: [],
  lookbackDays: 7,
  enableHoverPreview: false,
  pathCopyAffordance: "button",
};

const VIEW_TYPE_RECENT_EDITS = "recent-edits-view";
const SUPPORTED_EXTENSIONS = new Set(["md", "canvas", "base"]);
const HOVER_SOURCE = "recent-edits";

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

export default class RecentEditsPlugin extends Plugin {
  settings: RecentEditsSettings = DEFAULT_SETTINGS;
  private midnightTimer: number | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_RECENT_EDITS,
      (leaf) => new RecentEditsView(leaf, this)
    );

    this.addRibbonIcon("history", "Recent Edits", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open",
      name: "Open panel",
      callback: () => { void this.activateView(); },
    });

    this.addSettingTab(new RecentEditsSettingTab(this.app, this));

    this.scheduleMidnightRefresh();
  }

  onunload() {
    if (this.midnightTimer !== null) {
      window.clearTimeout(this.midnightTimer);
      this.midnightTimer = null;
    }
  }

  private scheduleMidnightRefresh() {
    if (this.midnightTimer !== null) {
      window.clearTimeout(this.midnightTimer);
    }
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      250
    );
    const delay = nextMidnight.getTime() - now.getTime();
    this.midnightTimer = window.setTimeout(() => {
      this.midnightTimer = null;
      this.refreshViews();
      this.scheduleMidnightRefresh();
    }, delay);
  }

  private parseFrontmatterDateTime(raw: string): number | null {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();

    // Try 24h format: "2026-06-08 16:51:59"
    const match24 = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
    );
    if (match24) {
      const [, y, m, d, h, min, s] = match24;
      const date = new Date(
        parseInt(y),
        parseInt(m) - 1,
        parseInt(d),
        parseInt(h),
        parseInt(min),
        parseInt(s)
      );
      return date.getTime();
    }

    // Try 12h format: "2026-06-05 11:35 AM"
    const match12 = trimmed.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i
    );
    if (match12) {
      const [, y, m, d, hStr, min, ampm] = match12;
      let h = parseInt(hStr);
      if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
      if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
      const date = new Date(
        parseInt(y),
        parseInt(m) - 1,
        parseInt(d),
        h,
        parseInt(min),
        0
      );
      return date.getTime();
    }

    // Try ISO format as fallback
    const parsed = Date.parse(trimmed);
    return isNaN(parsed) ? null : parsed;
  }

  private getFrontmatterDates(file: TFile): { created: number | null; updates: number[] } {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return { created: null, updates: [] };

    // Get createdDateTime (case-insensitive)
    let created: number | null = null;
    const createdKey = Object.keys(fm).find(
      (k) => k.toLowerCase() === "createddatetime"
    );
    if (createdKey) {
      created = this.parseFrontmatterDateTime(fm[createdKey]);
    }

    // Get lastUpdatedDateTimes
    const updates: number[] = [];
    const updatesRaw = fm.lastUpdatedDateTimes;
    if (Array.isArray(updatesRaw)) {
      for (const entry of updatesRaw) {
        const ts = this.parseFrontmatterDateTime(String(entry));
        if (ts !== null) updates.push(ts);
      }
    }

    return { created, updates };
  }

  getFileEntries(file: TFile): FileEntry[] {
    const { created, updates } = this.getFrontmatterDates(file);

    if (created === null && updates.length === 0) return [];

    // Build date map: dateKey -> { timestamp, isCreatedDate }
    const dateMap = new Map<string, { timestamp: number; isCreatedDate: boolean }>();

    // Get created date key
    const createdDateKey = created !== null ? formatDayKey(new Date(created)) : null;

    // Add update entries
    for (const ts of updates) {
      const dateKey = formatDayKey(new Date(ts));
      const existing = dateMap.get(dateKey);
      if (!existing || ts > existing.timestamp) {
        dateMap.set(dateKey, {
          timestamp: ts,
          isCreatedDate: dateKey === createdDateKey,
        });
      }
    }

    // Add created entry if not already covered
    if (created !== null && createdDateKey) {
      const existing = dateMap.get(createdDateKey);
      if (!existing) {
        dateMap.set(createdDateKey, {
          timestamp: created,
          isCreatedDate: true,
        });
      } else {
        // Mark as created date
        existing.isCreatedDate = true;
      }
    }

    // Convert to FileEntry array
    const entries: FileEntry[] = [];
    for (const [, { timestamp, isCreatedDate }] of dateMap) {
      entries.push({ file, timestamp, isCreatedDate });
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }

  dismissFile(file: TFile) {
    new Notice("Not yet implemented");
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_RECENT_EDITS);
    let leaf: WorkspaceLeaf | null;

    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getLeftLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_RECENT_EDITS,
          active: true,
        });
      }
    }

    if (leaf) await workspace.revealLeaf(leaf);
  }

  refreshViews() {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_RECENT_EDITS)
      .forEach((leaf) => {
        const view = leaf.view;
        if (view instanceof RecentEditsView) {
          view.scheduleRefresh();
        }
      });
  }

  async loadSettings() {
    const raw = ((await this.loadData()) as Record<string, unknown>) ?? {};
    const settingsBlob = { ...raw };
    delete (settingsBlob as Record<string, unknown>)._editSources;
    delete (settingsBlob as Record<string, unknown>)._editTimes;
    delete (settingsBlob as Record<string, unknown>)._dismissedAt;

    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      settingsBlob as Partial<RecentEditsSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }
}

class RecentEditsView extends ItemView {
  plugin: RecentEditsPlugin;
  private collapsedDays = new Set<string>();
  private showBackgroundFolders = false;
  private refreshTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RecentEditsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RECENT_EDITS;
  }

  getDisplayText(): string {
    return "Recent Edits";
  }

  getIcon(): string {
    return "history";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
  }

  private showFileMenu(evt: MouseEvent, file: TFile) {
    const menu = new Menu();
    const { workspace } = this.app;

    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("lucide-file-plus")
        .onClick(() => {
          void workspace.getLeaf("tab").openFile(file);
        })
    );

    menu.addItem((item) =>
      item
        .setTitle("Open to the right")
        .setIcon("lucide-separator-vertical")
        .onClick(() => {
          void workspace.getLeaf("split", "vertical").openFile(file);
        })
    );

    menu.addItem((item) =>
      item
        .setTitle("Open in new window")
        .setIcon("lucide-monitor")
        .onClick(() => {
          void workspace.getLeaf("window").openFile(file);
        })
    );

    workspace.trigger("file-menu", menu, file, "file-explorer-context-menu");

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Copy path")
        .setIcon("lucide-copy")
        .onClick(() => {
          void navigator.clipboard.writeText(file.path);
        })
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Rename...")
        .setIcon("lucide-pencil")
        .onClick(() => {
          new RenameFileModal(this.app, file).open();
        })
    );

    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("lucide-trash-2")
        .onClick(() => {
          new ConfirmDeleteModal(this.app, file).open();
        })
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Clear from list")
        .setIcon("lucide-eye-off")
        .onClick(() => {
          this.plugin.dismissFile(file);
        })
    );

    menu.showAtMouseEvent(evt);
  }

  private async openInNewTab(file: TFile) {
    const workspace = this.app.workspace;
    const leaf = workspace.getLeaf("tab");
    await leaf.openFile(file);
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const view = leaf.view as { file?: TFile };
      if (view.file === file) {
        found = leaf;
      }
    });
    return found;
  }

  scheduleRefresh() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.render();
      this.refreshTimer = null;
    }, 200);
  }

  private getRecentFiles(): DayGroup[] {
    const { lookbackDays, excludedFolders, backgroundFolders } =
      this.plugin.settings;
    const cutoff = Date.now() - lookbackDays * 86400000;
    const showBg = this.showBackgroundFolders;

    const matchesFolder = (path: string, folder: string): boolean => {
      const norm = folder.replace(/^\/+|\/+$/g, "");
      if (!norm) return false;
      return path === norm || path.startsWith(norm + "/");
    };

    const all = this.app.vault.getFiles();
    const groupsMap = new Map<string, DayGroup>();

    for (const f of all) {
      if (!SUPPORTED_EXTENSIONS.has(f.extension)) continue;

      // Check folder exclusions
      const segs = f.path.split("/");
      let excluded = false;
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i].startsWith(".")) { excluded = true; break; }
      }
      if (excluded) continue;

      for (const ex of excludedFolders) {
        if (matchesFolder(f.path, ex)) { excluded = true; break; }
      }
      if (excluded) continue;

      if (!showBg) {
        for (const bg of backgroundFolders) {
          if (matchesFolder(f.path, bg)) { excluded = true; break; }
        }
      }
      if (excluded) continue;

      // Get entries from frontmatter
      const entries = this.plugin.getFileEntries(f);
      if (entries.length === 0) continue;

      // Add entries to groups
      for (const entry of entries) {
        if (entry.timestamp < cutoff) continue;

        const d = new Date(entry.timestamp);
        const key = formatDayKey(d);
        let g = groupsMap.get(key);
        if (!g) {
          g = { key, date: startOfLocalDay(d), files: [] };
          groupsMap.set(key, g);
        }
        g.files.push(entry);
      }
    }

    const groups = Array.from(groupsMap.values());
    groups.sort((a, b) => b.date.getTime() - a.date.getTime());
    for (const g of groups) {
      g.files.sort((a, b) => b.timestamp - a.timestamp);
    }
    return groups;
  }

  render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("recent-edits-container");

    const hasBackground = this.plugin.settings.backgroundFolders.length > 0;
    const groups = this.getRecentFiles();

    if (groups.length === 0) {
      const days = this.plugin.settings.lookbackDays;
      const empty = container.createDiv({ cls: "recent-edits-empty" });
      empty.setText(
        `No edits in the last ${days} day${days === 1 ? "" : "s"}.`
      );
      if (hasBackground && !this.showBackgroundFolders) {
        const action = container.createDiv({
          cls: "recent-edits-empty-action",
        });
        const link = action.createEl("a", { text: "Show background folders" });
        link.addEventListener("click", (evt) => {
          evt.preventDefault();
          this.showBackgroundFolders = true;
          this.render();
        });
      }
      return;
    }

    const list = container.createDiv({ cls: "recent-edits-list" });
    for (const g of groups) {
      this.renderGroup(list, g, hasBackground);
    }
  }

  private renderGroup(
    parent: HTMLElement,
    g: DayGroup,
    withBgToggle: boolean
  ) {
    const groupEl = parent.createDiv({ cls: "recent-edits-group" });
    if (this.collapsedDays.has(g.key)) groupEl.dataset.collapsed = "true";

    const header = groupEl.createDiv({ cls: "recent-edits-day-header" });
    const chevron = header.createSpan({ cls: "recent-edits-chevron" });
    setIcon(chevron, "chevron-down");
    header.createSpan({
      cls: "recent-edits-day-label",
      text: formatDayLabel(g.date),
    });

    if (withBgToggle) {
      const toggle = header.createSpan({ cls: "recent-edits-bg-toggle" });
      if (this.showBackgroundFolders) toggle.addClass("is-active");
      const iconEl = toggle.createSpan({
        cls: "recent-edits-bg-toggle-icon",
      });
      setIcon(iconEl, "archive");
      toggle.createSpan({
        cls: "recent-edits-bg-toggle-label",
        text: this.showBackgroundFolders ? "Less" : "More",
      });
      toggle.setAttribute(
        "aria-label",
        this.showBackgroundFolders
          ? "Hide background folders"
          : "Show background folders"
      );
      toggle.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.showBackgroundFolders = !this.showBackgroundFolders;
        this.render();
      });
    }

    header.createSpan({
      cls: "recent-edits-day-count",
      text: String(g.files.length),
    });
    header.addEventListener("click", () => {
      if (this.collapsedDays.has(g.key)) {
        this.collapsedDays.delete(g.key);
        delete groupEl.dataset.collapsed;
      } else {
        this.collapsedDays.add(g.key);
        groupEl.dataset.collapsed = "true";
      }
    });

    const filesEl = groupEl.createDiv({ cls: "recent-edits-day-files" });
    for (const entry of g.files) {
      this.renderFileRow(filesEl, entry);
    }
  }

  private renderFileRow(parent: HTMLElement, entry: FileEntry) {
    const file = entry.file;
    const row = parent.createDiv({ cls: "recent-edits-row" });
    if (entry.isCreatedDate) {
      row.addClass("is-new-file");
    }

    const info = row.createDiv({ cls: "recent-edits-row-info" });
    const name = info.createEl("div", {
      cls: "recent-edits-row-name",
      text: file.basename,
    });
    name.setAttribute("title", file.path);

    const folderPath = file.parent ? file.parent.path : "";
    const displayPath =
      folderPath === "" || folderPath === "/" ? "/" : folderPath + "/";
    const pathEl = info.createDiv({
      cls: "recent-edits-row-path",
      text: displayPath,
    });

    const affordance = this.plugin.settings.pathCopyAffordance;
    const showButton = affordance === "button" || affordance === "both";
    const pathTextIsCopyTarget =
      affordance === "path-text" || affordance === "both";

    const copyAbsolutePath = async (evt: Event) => {
      evt.stopPropagation();
      const adapter = this.app.vault.adapter;
      if (adapter instanceof FileSystemAdapter) {
        const fullPath = adapter.getFullPath(file.path);
        await navigator.clipboard.writeText(fullPath);
        new Notice("Path copied");
      } else {
        new Notice("Absolute path unavailable on this platform");
      }
    };

    if (pathTextIsCopyTarget) {
      pathEl.addClass("is-copy-target");
      pathEl.setAttribute("aria-label", "Click to copy absolute path");
      pathEl.addEventListener("click", (evt) => { void copyAbsolutePath(evt); });
    }

    const meta = row.createDiv({ cls: "recent-edits-row-meta" });
    if (showButton) {
      meta.addClass("has-button");
      const btn = meta.createDiv({
        cls: "recent-edits-row-copy-btn",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": "Copy absolute path",
        },
      });
      setIcon(btn, "link");
      btn.addEventListener("click", (evt) => { void copyAbsolutePath(evt); });
      btn.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          void copyAbsolutePath(evt);
        }
      });
    }
    meta.createSpan({
      cls: "recent-edits-row-time",
      text: formatTime12h(new Date(entry.timestamp)),
    });

    row.addEventListener("click", (evt) => {
      const forceNewTab = evt.metaKey || evt.ctrlKey;
      if (!forceNewTab) {
        const existing = this.findLeafForFile(file);
        if (existing) {
          this.app.workspace.setActiveLeaf(existing, { focus: true });
          return;
        }
      }
      void this.openInNewTab(file);
    });

    row.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showFileMenu(evt, file);
    });

    if (this.plugin.settings.enableHoverPreview) {
      row.addEventListener("mouseover", (evt) => {
        this.app.workspace.trigger("hover-link", {
          event: evt,
          source: HOVER_SOURCE,
          hoverParent: this,
          targetEl: row,
          linktext: file.path,
        });
      });
    }
  }
}

class RecentEditsSettingTab extends PluginSettingTab {
  plugin: RecentEditsPlugin;

  constructor(app: App, plugin: RecentEditsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("recent-edits-settings");

    new Setting(containerEl)
      .setName("Lookback days")
      .setDesc("How many days back to show. Range: 1 to 90.")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.lookbackDays))
          .onChange(async (val) => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n >= 1 && n <= 90) {
              this.plugin.settings.lookbackDays = n;
              await this.plugin.saveSettings();
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "90";
      });

    new Setting(containerEl)
      .setName("Hover preview")
      .setDesc(
        "Show Obsidian's page preview popup when hovering an entry. Requires the Page Preview core plugin."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHoverPreview)
          .onChange(async (val) => {
            this.plugin.settings.enableHoverPreview = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Copy absolute path affordance")
      .setDesc(
        "How to expose the 'copy absolute path to clipboard' action on each row. The button is an explicit, always-visible target; the folder-path text is a subtler invisible affordance. Use Both to expose both."
      )
      .addDropdown((dd) =>
        dd
          .addOption("button", "Button above the time")
          .addOption("path-text", "Folder-path text")
          .addOption("both", "Both")
          .setValue(this.plugin.settings.pathCopyAffordance)
          .onChange(async (val) => {
            this.plugin.settings.pathCopyAffordance =
              val as PathCopyAffordance;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Filtering").setHeading();

    this.addFolderListSetting(containerEl, {
      name: "Background folders",
      desc: "Folders hidden by default. Use the toggle in the panel header to show them temporarily. Useful for files that update often but you only check occasionally.",
      getValue: () => this.plugin.settings.backgroundFolders,
      setValue: async (v) => {
        this.plugin.settings.backgroundFolders = v;
        await this.plugin.saveSettings();
      },
      placeholder: "Type a folder path...",
      datalistId: "recent-edits-background-folder-list",
    });

    this.addFolderListSetting(containerEl, {
      name: "Excluded folders",
      desc: `Folders hidden from the list completely. Dot-prefixed folders (${this.app.vault.configDir}, .trash) are always excluded.`,
      getValue: () => this.plugin.settings.excludedFolders,
      setValue: async (v) => {
        this.plugin.settings.excludedFolders = v;
        await this.plugin.saveSettings();
      },
      placeholder: "Type a folder path...",
      datalistId: "recent-edits-excluded-folder-list",
    });
  }

  private addFolderListSetting(
    containerEl: HTMLElement,
    opts: {
      name: string;
      desc: string;
      getValue: () => string[];
      setValue: (v: string[]) => Promise<void>;
      placeholder: string;
      datalistId: string;
    }
  ): void {
    new Setting(containerEl).setName(opts.name).setDesc(opts.desc);

    const wrapper = containerEl.createDiv({
      cls: "recent-edits-folder-list",
    });

    const chipContainer = wrapper.createDiv({
      cls: "recent-edits-chip-container",
    });

    const renderChips = () => {
      chipContainer.empty();
      const values = opts.getValue();
      if (values.length === 0) {
        chipContainer.createSpan({
          cls: "recent-edits-chip-empty",
          text: "None.",
        });
        return;
      }
      for (const folder of values) {
        const chip = chipContainer.createSpan({ cls: "recent-edits-chip" });
        chip.createSpan({
          cls: "recent-edits-chip-label",
          text: folder,
        });
        const x = chip.createSpan({
          cls: "recent-edits-chip-x",
          text: "\u00d7",
        });
        x.setAttribute("aria-label", `Remove ${folder}`);
        x.addEventListener("click", () => {
          void opts.setValue(opts.getValue().filter((f) => f !== folder)).then(() => renderChips());
        });
      }
    };
    renderChips();

    const inputWrapper = wrapper.createDiv({
      cls: "recent-edits-folder-input-wrapper",
    });
    const input = inputWrapper.createEl("input", {
      type: "text",
      cls: "recent-edits-folder-input",
      attr: { placeholder: opts.placeholder },
    });

    const datalist = inputWrapper.createEl("datalist", {
      attr: { id: opts.datalistId },
    });
    input.setAttribute("list", opts.datalistId);

    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => f.path)
      .filter((p) => p && p !== "/")
      .sort();
    for (const path of folders) {
      datalist.createEl("option", { value: path });
    }

    const addBtn = inputWrapper.createEl("button", {
      cls: "recent-edits-add-btn mod-cta",
      text: "Add",
    });
    const addCurrent = async () => {
      const trimmed = input.value.trim();
      if (!trimmed) return;
      const val = normalizePath(trimmed).replace(/^\/+/, "");
      if (!val || val === "/") return;
      if (!opts.getValue().includes(val)) {
        await opts.setValue([...opts.getValue(), val]);
        renderChips();
      }
      input.value = "";
      input.focus();
    };
    addBtn.addEventListener("click", () => { void addCurrent(); });
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void addCurrent();
      }
    });
  }
}

function formatDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayLabel(d: Date): string {
  const today = startOfLocalDay(new Date());
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${formatDayKey(d)} (${weekday})`;
}

function formatTime12h(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

class RenameFileModal extends Modal {
  private file: TFile;

  constructor(app: App, file: TFile) {
    super(app);
    this.file = file;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Rename file");

    contentEl.createEl("p", {
      cls: "recent-edits-modal-current",
      text: this.file.path,
    });

    const inputEl = contentEl.createEl("input", {
      type: "text",
      cls: "recent-edits-modal-input",
    });
    inputEl.value = this.file.basename;

    const buttonRow = contentEl.createDiv({ cls: "recent-edits-modal-buttons" });
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    const renameBtn = buttonRow.createEl("button", {
      cls: "mod-cta",
      text: "Rename",
    });

    const submit = async () => {
      const newName = inputEl.value.trim();
      if (!newName || newName === this.file.basename) {
        this.close();
        return;
      }
      const parentPath = this.file.parent?.path ?? "";
      const parentPrefix =
        parentPath && parentPath !== "/" ? `${parentPath}/` : "";
      const newPath = normalizePath(
        `${parentPrefix}${newName}.${this.file.extension}`
      );
      await this.app.fileManager.renameFile(this.file, newPath);
      this.close();
    };

    renameBtn.addEventListener("click", () => { void submit(); });
    cancelBtn.addEventListener("click", () => this.close());
    inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        void submit();
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        this.close();
      }
    });

    window.setTimeout(() => {
      inputEl.focus();
      inputEl.select();
    }, 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmDeleteModal extends Modal {
  private file: TFile;

  constructor(app: App, file: TFile) {
    super(app);
    this.file = file;
  }

  onOpen() {
    const { contentEl, titleEl } = this;
    titleEl.setText("Delete file");

    contentEl.createEl("p", {
      text: `Move "${this.file.path}" to system trash?`,
    });

    const buttonRow = contentEl.createDiv({ cls: "recent-edits-modal-buttons" });
    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    const deleteBtn = buttonRow.createEl("button", {
      cls: "mod-warning",
      text: "Delete",
    });

    deleteBtn.addEventListener("click", () => {
      void this.app.fileManager.trashFile(this.file).then(() => this.close());
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
