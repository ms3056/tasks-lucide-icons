import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon
} from "obsidian";
import {
  ViewPlugin,
  Decoration,
  DecorationSet,
  EditorView,
  ViewUpdate,
  WidgetType
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

export type RuleMode = "icon" | "css";

export interface ReplacementRule {
  id: string;
  label: string;
  pattern: string;
  isRegex: boolean;
  mode?: RuleMode;
  cssClass?: string;
  icon: string;
  color: string;
  scale?: number;
  enabled: boolean;
  isCore: boolean;
}

const VOID_OR_RESERVED_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
  "script", "style", "textarea", "select", "option", "iframe",
  "object", "canvas", "svg", "math", "head", "html", "body", "title"
]);

export function parseCssWrapTarget(raw: string | undefined): {
  tagName: string;
  className: string;
  cleanTokens: string[];
} {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/^[<./]+|[>/]+$/g, "")
    .trim();
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^\.+/, "").replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      tagName: "span",
      className: "tli-css-wrap",
      cleanTokens: []
    };
  }

  const first = tokens[0].toLowerCase();
  const isValidTag =
    /^[a-z][a-z0-9-]*$/.test(first) && !VOID_OR_RESERVED_TAGS.has(first);
  const tagName = isValidTag ? first : "span";
  const className = `${tokens.join(" ")} tli-css-wrap`;
  return {
    tagName,
    className,
    cleanTokens: tokens
  };
}

// Per-rule icon scale bounds (custom rules). The CSS additionally hard-clamps
// the rendered pixel size, so values outside these bounds (e.g. hand-edited
// data.json) can never break layout or alignment.
export const CUSTOM_SCALE_MIN = 0.5;
export const CUSTOM_SCALE_MAX = 2.0;

export function clampScale(value: number | undefined | null): number {
  const n = typeof value === "number" && !isNaN(value) ? value : 1;
  return Math.min(CUSTOM_SCALE_MAX, Math.max(CUSTOM_SCALE_MIN, n));
}

export interface StatusIconSettings {
  /** Replace task checkboxes with per-status glyphs (was snippets/task-icons.css). */
  enabled: boolean;
  /** Grey out / fade completed tasks (was snippets/completed-tasks-gray.css). */
  muteCompleted: boolean;
  /** Per-status color overrides keyed by StatusDef.key. Missing = theme color. */
  colors: Record<string, string>;
}

export interface TasksLucideSettings {
  coreRules: ReplacementRule[];
  customRules: ReplacementRule[];
  statusIcons: StatusIconSettings;
}

/**
 * Checkbox status glyphs. `key` becomes the CSS variable --tli-status-<key>
 * read by styles.css; `themeVar` is the fallback used when no override is set.
 */
export interface StatusDef {
  key: string;
  chars: string;
  label: string;
  themeVar: string;
}

export const STATUS_DEFS: StatusDef[] = [
  { key: "done", chars: "x X", label: "Done", themeVar: "--color-green" },
  { key: "forwarded", chars: ">", label: "Forwarded / moved", themeVar: "--color-blue" },
  { key: "scheduled", chars: "<", label: "Scheduled / back", themeVar: "--color-cyan" },
  { key: "in-progress", chars: "/", label: "In progress", themeVar: "--color-yellow" },
  { key: "cancelled", chars: "-", label: "Cancelled", themeVar: "--color-red" },
  { key: "important", chars: "!", label: "Important", themeVar: "--color-orange" },
  { key: "question", chars: "?", label: "Question", themeVar: "--color-purple" },
  { key: "star", chars: "*", label: "Star", themeVar: "--color-yellow" },
  { key: "quote", chars: "\"", label: "Quote", themeVar: "--text-muted" },
  { key: "bookmark", chars: "b", label: "Bookmark", themeVar: "--color-blue" },
  { key: "info", chars: "i I", label: "Info", themeVar: "--color-cyan" },
  { key: "pin", chars: "p", label: "Pin", themeVar: "--color-red" },
  { key: "location", chars: "l", label: "Location", themeVar: "--color-blue" },
  { key: "up", chars: "u", label: "Up", themeVar: "--interactive-accent" },
  { key: "down", chars: "d", label: "Down", themeVar: "--color-purple" },
  { key: "note", chars: "n", label: "Note", themeVar: "--text-muted" },
  { key: "someday-done", chars: "c", label: "Done (someday)", themeVar: "--text-faint" },
  { key: "savings", chars: "S", label: "Savings", themeVar: "--color-yellow" },
  { key: "someday", chars: "\\", label: "Someday", themeVar: "--text-faint" }
];

export const DEFAULT_STATUS_ICONS: StatusIconSettings = {
  enabled: true,
  muteCompleted: true,
  colors: {}
};

/** Resolve any CSS color (var-resolved string, rgb(), named) to #rrggbb. */
function cssColorToHex(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#888888";
  ctx.fillStyle = "#888888";
  ctx.fillStyle = color.trim() || "#888888";
  const v = ctx.fillStyle;
  if (v.startsWith("#")) return v;
  const m = v.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#888888";
  return "#" + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("");
}

export const DEFAULT_CORE_RULES: ReplacementRule[] = [
  { id: "core-due", label: "Due date", pattern: "📅", isRegex: false, icon: "calendar", color: "#3b82f6", enabled: true, isCore: true },
  { id: "core-scheduled", label: "Scheduled date", pattern: "⏳", isRegex: false, icon: "hourglass", color: "#94a3b8", enabled: true, isCore: true },
  { id: "core-start", label: "Start date", pattern: "🛫", isRegex: false, icon: "plane-takeoff", color: "#94a3b8", enabled: true, isCore: true },
  { id: "core-created", label: "Created date", pattern: "➕", isRegex: false, icon: "plus-circle", color: "#64748b", enabled: true, isCore: true },
  { id: "core-done", label: "Done date", pattern: "✅", isRegex: false, icon: "check-circle-2", color: "#22c55e", enabled: true, isCore: true },
  { id: "core-cancelled", label: "Cancelled date", pattern: "❌", isRegex: false, icon: "x-circle", color: "#71717a", enabled: true, isCore: true },
  { id: "core-recurrence", label: "Recurrence", pattern: "🔁", isRegex: false, icon: "repeat", color: "#8b5cf6", enabled: true, isCore: true },
  { id: "core-p-highest", label: "Highest priority", pattern: "🔺", isRegex: false, icon: "chevrons-up", color: "#ef4444", enabled: true, isCore: true },
  { id: "core-p-high", label: "High priority", pattern: "⏫", isRegex: false, icon: "chevron-up", color: "#f97316", enabled: true, isCore: true },
  { id: "core-p-medium", label: "Medium priority", pattern: "🔼", isRegex: false, icon: "minus", color: "#eab308", enabled: true, isCore: true },
  { id: "core-p-low", label: "Low priority", pattern: "🔽", isRegex: false, icon: "chevron-down", color: "#3b82f6", enabled: true, isCore: true },
  { id: "core-p-lowest", label: "Lowest priority", pattern: "⏬", isRegex: false, icon: "chevrons-down", color: "#94a3b8", enabled: true, isCore: true },
  { id: "core-id", label: "Task ID", pattern: "🆔", isRegex: false, icon: "key", color: "#64748b", enabled: true, isCore: true },
  { id: "core-depends", label: "Depends on", pattern: "⛔", isRegex: false, icon: "ban", color: "#ef4444", enabled: true, isCore: true },
  { id: "core-edit", label: "Edit task", pattern: "📝", isRegex: false, icon: "pencil", color: "#64748b", enabled: true, isCore: true },
  { id: "core-postpone", label: "Postpone task", pattern: "⏩", isRegex: false, icon: "calendar-clock", color: "#3b82f6", enabled: true, isCore: true }
];

export const DEFAULT_SETTINGS: TasksLucideSettings = {
  coreRules: DEFAULT_CORE_RULES.map((r) => ({ ...r })),
  customRules: [],
  statusIcons: { ...DEFAULT_STATUS_ICONS, colors: {} }
};

const POPULAR_LUCIDE_ICONS: string[] = [
  "calendar", "calendar-clock", "calendar-check", "clock", "hourglass", "timer",
  "alarm-clock", "plane-takeoff", "rocket", "plus-circle", "check-circle-2",
  "check", "check-square", "pencil", "x-circle", "x", "repeat", "refresh-cw", "chevrons-up",
  "chevron-up", "minus", "chevron-down", "chevrons-down", "arrow-up", "arrow-down",
  "flame", "zap", "alert-triangle", "alert-circle", "bell", "bookmark", "flag",
  "star", "heart", "tag", "tags", "hash", "at-sign", "user", "users", "Phone",
  "mail", "message-square", "Home", "briefcase", "folder", "file-text", "link",
  "lock", "unlock", "key", "ban", "shield", "eye", "search", "settings", "wrench",
  "sparkles", "lightbulb", "target", "trophy", "compass", "map-pin", "globe",
  "coffee", "shopping-cart", "credit-card", "dollar-sign", "laptop", "terminal",
  "code", "bug", "git-branch", "git-pull-request", "database", "cloud", "inbox",
  "send", "archive", "trash-2", "clipboard-list", "layers", "activity"
].map((s) => s.toLowerCase());

interface CompiledRule {
  rule: ReplacementRule;
  regex: RegExp;
}

interface MatchInstance {
  from: number;
  to: number;
  matchedText: string;
  rule: ReplacementRule;
}

class LucideRuleWidget extends WidgetType {
  private readonly scale: number;

  constructor(
    private readonly matchedText: string,
    private readonly icon: string,
    private readonly color: string,
    private readonly label: string,
    scale: number = 1
  ) {
    super();
    this.scale = clampScale(scale);
  }

  eq(other: LucideRuleWidget): boolean {
    return (
      other.matchedText === this.matchedText &&
      other.icon === this.icon &&
      other.color === this.color &&
      other.label === this.label &&
      other.scale === this.scale
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "tasks-inline-lucide-icon";
    span.setAttribute("data-task-icon", this.icon);
    span.setAttribute("aria-label", this.label || this.matchedText);
    span.style.setProperty("--tli-icon-scale", String(this.scale));
    if (this.color) {
      span.style.color = this.color;
    }
    setIcon(span, this.icon);
    if (!span.querySelector("svg")) {
      setIcon(span, "circle-help");
    }
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCursorInside(view: EditorView, from: number, to: number): boolean {
  for (const range of view.state.selection.ranges) {
    if (range.from <= to && range.to >= from) {
      return true;
    }
  }
  return false;
}

export default class TasksLucidePlugin extends Plugin {
  settings: TasksLucideSettings = DEFAULT_SETTINGS;
  compiledRules: CompiledRule[] = [];
  private observer: MutationObserver | null = null;
  /** Open/collapsed state of settings sections, kept across display() re-renders. */
  sectionCollapsed: Record<string, boolean> = {};

  async onload() {
    await this.loadSettings();
    this.compileRules();
    this.applyStatusStyles();

    this.addSettingTab(new TasksLucideSettingTab(this.app, this));

    const pluginInstance = this;

    // 1. Live Preview / CodeMirror 6 Extension
    const viewPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = pluginInstance.buildEditorDecorations(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = pluginInstance.buildEditorDecorations(update.view);
          }
        }
      },
      {
        decorations: (v) => v.decorations
      }
    );

    this.registerEditorExtension([viewPlugin]);

    // 2. Reading View Post-Processor
    this.registerMarkdownPostProcessor((element) => {
      this.replaceInContainer(element);
    });

    // 3. Global Observer for Sidebars & Tasks Query Blocks
    this.app.workspace.onLayoutReady(() => {
      this.refreshAllViews();
      this.setupWorkspaceObserver();
    });
  }

  onunload() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.restoreOriginalNodes();
    this.clearStatusStyles();
  }

  /**
   * Push checkbox-status settings to <body>: two gate classes plus one
   * --tli-status-<key> variable per overridden color. styles.css falls back to
   * the theme color when a variable is unset. Cheap; safe to call on every change.
   */
  applyStatusStyles() {
    const s = this.settings.statusIcons;
    document.body.toggleClass("tli-status-icons", s.enabled);
    document.body.toggleClass("tli-mute-completed", s.muteCompleted);
    for (const def of STATUS_DEFS) {
      const value = s.colors[def.key];
      if (value) {
        document.body.style.setProperty(`--tli-status-${def.key}`, value);
      } else {
        document.body.style.removeProperty(`--tli-status-${def.key}`);
      }
    }
  }

  clearStatusStyles() {
    document.body.removeClass("tli-status-icons");
    document.body.removeClass("tli-mute-completed");
    for (const def of STATUS_DEFS) {
      document.body.style.removeProperty(`--tli-status-${def.key}`);
    }
  }

  /** Save + apply status styles without rebuilding every editor decoration. */
  async saveStatusSettings() {
    await this.saveData(this.settings);
    this.applyStatusStyles();
  }

  async loadSettings() {
    const loaded = await this.loadData();
    const mergedCore = DEFAULT_CORE_RULES.map((defRule) => {
      const existing = loaded?.coreRules?.find((r: ReplacementRule) => r.id === defRule.id);
      if (existing) {
        return {
          ...defRule,
          icon: existing.icon ?? defRule.icon,
          color: existing.color ?? defRule.color,
          enabled: existing.enabled ?? defRule.enabled
        };
      }
      return { ...defRule };
    });

    const customRules: ReplacementRule[] = Array.isArray(loaded?.customRules)
      ? loaded.customRules.map((r: ReplacementRule) => ({
          id: r.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: r.label ?? "Custom rule",
          pattern: r.pattern ?? "",
          isRegex: true,
          mode: r.mode === "css" ? "css" : "icon",
          cssClass: r.cssClass ?? "",
          icon: r.icon || "tag",
          color: r.color || "#3b82f6",
          scale: clampScale(r.scale),
          enabled: r.enabled ?? true,
          isCore: false
        }))
      : [];

    const loadedStatus = loaded?.statusIcons ?? {};
    const statusColors: Record<string, string> = {};
    if (loadedStatus.colors && typeof loadedStatus.colors === "object") {
      for (const def of STATUS_DEFS) {
        const c = loadedStatus.colors[def.key];
        if (typeof c === "string" && c) statusColors[def.key] = c;
      }
    }

    this.settings = {
      coreRules: mergedCore,
      customRules,
      statusIcons: {
        enabled: loadedStatus.enabled ?? DEFAULT_STATUS_ICONS.enabled,
        muteCompleted: loadedStatus.muteCompleted ?? DEFAULT_STATUS_ICONS.muteCompleted,
        colors: statusColors
      }
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.compileRules();
    this.refreshAllViews();
  }

  compileRules() {
    const compiled: CompiledRule[] = [];
    const allRules = [...this.settings.coreRules, ...this.settings.customRules];

    for (const rule of allRules) {
      if (!rule.enabled || !rule.pattern || rule.pattern.trim() === "") continue;
      if (rule.mode === "css") {
        const { cleanTokens } = parseCssWrapTarget(rule.cssClass);
        if (cleanTokens.length === 0) continue;
      }
      try {
        const source = rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern);
        const regex = new RegExp(source, "g");
        compiled.push({ rule, regex });
      } catch {
        // Ignore invalid regex during live typing
      }
    }
    this.compiledRules = compiled;
  }

  findMatchesInText(text: string): MatchInstance[] {
    if (!text || this.compiledRules.length === 0) return [];
    const matches: MatchInstance[] = [];

    for (const { rule, regex } of this.compiledRules) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let safety = 0;
      while ((m = regex.exec(text)) !== null && safety < 2000) {
        safety++;
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        matches.push({
          from: m.index,
          to: m.index + m[0].length,
          matchedText: m[0],
          rule
        });
      }
    }

    if (matches.length <= 1) return matches;

    // Sort by start position ascending, then by match length descending
    matches.sort((a, b) => (a.from !== b.from ? a.from - b.from : b.to - a.to));

    // Filter overlapping matches
    const nonOverlapping: MatchInstance[] = [];
    let lastEnd = -1;
    for (const item of matches) {
      if (item.from >= lastEnd) {
        nonOverlapping.push(item);
        lastEnd = item.to;
      }
    }
    return nonOverlapping;
  }

  buildEditorDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    if (this.compiledRules.length === 0) return builder.finish();

    for (const { from, to } of view.visibleRanges) {
      const slice = view.state.doc.sliceString(from, to);
      const matches = this.findMatchesInText(slice);

      for (const m of matches) {
        const absFrom = from + m.from;
        const absTo = from + m.to;

        if (m.rule.mode === "css") {
          const { tagName, className } = parseCssWrapTarget(m.rule.cssClass);
          const markDeco = Decoration.mark({
            tagName,
            class: className,
            attributes: m.rule.label ? { "data-tli-label": m.rule.label } : undefined
          });

          // Mark decorations cannot cross line breaks in CM6; split per line if needed.
          if (m.matchedText.includes("\n")) {
            let segStart = absFrom;
            for (let i = 0; i < m.matchedText.length; i++) {
              if (m.matchedText[i] === "\n") {
                const segEnd = absFrom + i;
                if (segEnd > segStart) {
                  builder.add(segStart, segEnd, markDeco);
                }
                segStart = segEnd + 1;
              }
            }
            if (absTo > segStart) {
              builder.add(segStart, absTo, markDeco);
            }
          } else {
            builder.add(absFrom, absTo, markDeco);
          }
          continue;
        }

        if (isCursorInside(view, absFrom, absTo)) continue;

        builder.add(
          absFrom,
          absTo,
          Decoration.replace({
            widget: new LucideRuleWidget(
              m.matchedText,
              m.rule.icon,
              m.rule.color,
              m.rule.label,
              m.rule.scale
            )
          })
        );
      }
    }
    return builder.finish();
  }

  refreshAllViews() {
    // 1. Force CodeMirror 6 editors to re-evaluate decorations
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as any;
      if (view?.editor?.cm instanceof EditorView) {
        const cm: EditorView = view.editor.cm;
        cm.dispatch({ selection: cm.state.selection });
      }
    });

    // 2. Restore any previously replaced DOM widgets in Reading/Sidebar views, then re-apply
    this.restoreOriginalNodes();
    const containers = document.querySelectorAll(
      ".markdown-preview-view, .workspace-leaf-content:not(:has(.cm-editor))"
    );
    containers.forEach((c) => {
      if (c instanceof HTMLElement) {
        this.replaceInContainer(c);
      }
    });

    document
      .querySelectorAll<HTMLElement>(".cm-editor .cm-preview-code-block.cm-lang-tasks")
      .forEach((block) => this.replaceInContainer(block));
  }

  private restoreOriginalNodes() {
    const actionIcons = document.querySelectorAll<HTMLElement>(".tasks-lucide-action-icon");
    actionIcons.forEach((icon) => {
      icon.parentElement?.classList.remove("tasks-lucide-action-replaced");
      icon.remove();
    });

    const existingNodes = document.querySelectorAll(
      ".tasks-inline-lucide-icon[data-raw-text], .tli-css-wrap[data-raw-text]"
    );
    existingNodes.forEach((el) => {
      const raw = el.getAttribute("data-raw-text");
      if (raw && el.parentNode) {
        const textNode = document.createTextNode(raw);
        el.parentNode.replaceChild(textNode, el);
      }
    });
    // Normalize adjacent text nodes
    document.body.normalize();
  }

  private setupWorkspaceObserver() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node instanceof HTMLElement) {
            if (node.closest(".modal-container")) continue;
            if (
              node.closest(
                ".tasks-inline-lucide-icon, .tasks-lucide-action-icon, .tli-css-wrap"
              )
            ) continue;
            const taskBlock = node.closest<HTMLElement>(
              ".cm-preview-code-block.cm-lang-tasks"
            );
            if (taskBlock) {
              this.replaceInContainer(node);
              continue;
            }
            if (node.closest(".cm-editor")) continue;
            this.replaceInContainer(node);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  replaceInContainer(root: HTMLElement) {
    this.replaceTaskActionIcons(root);
    if (this.compiledRules.length === 0) return;
    const isLivePreviewTaskBlock =
      root.closest(".cm-preview-code-block.cm-lang-tasks") !== null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const isInCodeMirror = parent.closest(".cm-editor") !== null;
        if (
          (isInCodeMirror && !isLivePreviewTaskBlock) ||
          parent.closest(".modal-container") ||
          parent.closest(".tli-rule-card") ||
          parent.classList.contains("tasks-inline-lucide-icon") ||
          parent.classList.contains("tli-css-wrap") ||
          parent.closest(".tli-css-wrap") ||
          parent.tagName === "SCRIPT" ||
          parent.tagName === "STYLE" ||
          parent.tagName === "CODE" ||
          parent.tagName === "PRE"
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        const val = node.nodeValue || "";
        const matches = this.findMatchesInText(val);
        return matches.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    const textNodes: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text) continue;
      const parent = textNode.parentNode;
      if (!parent) continue;

      const matches = this.findMatchesInText(text);
      if (matches.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const m of matches) {
        if (m.from > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, m.from)));
        }

        if (m.rule.mode === "css") {
          const { tagName, className } = parseCssWrapTarget(m.rule.cssClass);
          const wrapEl = document.createElement(tagName);
          wrapEl.className = className;
          if (m.rule.label) {
            wrapEl.setAttribute("data-tli-label", m.rule.label);
          }
          wrapEl.setAttribute("data-raw-text", m.matchedText);
          wrapEl.textContent = m.matchedText;
          fragment.appendChild(wrapEl);
        } else {
          const widgetEl = new LucideRuleWidget(
            m.matchedText,
            m.rule.icon,
            m.rule.color,
            m.rule.label,
            m.rule.scale
          ).toDOM();
          widgetEl.setAttribute("data-raw-text", m.matchedText);
          fragment.appendChild(widgetEl);
        }
        cursor = m.to;
      }

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }

      parent.replaceChild(fragment, textNode);
    }
  }

  private replaceTaskActionIcons(root: HTMLElement) {
    const actionRules = [
      { selector: ".tasks-edit", ruleId: "core-edit" },
      { selector: ".tasks-postpone", ruleId: "core-postpone" }
    ];

    for (const { selector, ruleId } of actionRules) {
      const rule = this.settings.coreRules.find((candidate) => candidate.id === ruleId);
      const elements = [
        ...(root.matches(selector) ? [root] : []),
        ...Array.from(root.querySelectorAll<HTMLElement>(selector))
      ];

      for (const element of elements) {
        const existingIcon = element.querySelector<HTMLElement>(
          ":scope > .tasks-lucide-action-icon"
        );
        if (!rule?.enabled) {
          existingIcon?.remove();
          element.classList.remove("tasks-lucide-action-replaced");
          continue;
        }
        if (existingIcon) continue;

        const icon = document.createElement("span");
        icon.className = "tasks-lucide-action-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.style.color = rule.color;
        setIcon(icon, rule.icon);
        if (!icon.querySelector("svg")) {
          setIcon(icon, "circle-help");
        }

        element.classList.add("tasks-lucide-action-replaced");
        element.appendChild(icon);
      }
    }
  }
}

class LucideIconPickerModal extends Modal {
  private searchQuery = "";
  private gridEl!: HTMLElement;

  constructor(
    app: App,
    private readonly currentIcon: string,
    private readonly currentColor: string,
    private readonly onSelect: (iconName: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Choose a Lucide Icon" });

    const searchInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "Type any Lucide icon ID (e.g. calendar, flame, tag, rocket)..."
    });
    searchInput.style.width = "100%";
    searchInput.value = this.currentIcon;

    this.gridEl = contentEl.createDiv({ cls: "tli-icon-modal-grid" });

    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.renderGrid();
    });

    this.renderGrid();
    setTimeout(() => searchInput.focus(), 50);
  }

  private renderGrid() {
    this.gridEl.empty();
    const candidates = new Set<string>();
    if (this.searchQuery.length > 0) {
      candidates.add(this.searchQuery);
    }
    for (const icon of POPULAR_LUCIDE_ICONS) {
      if (!this.searchQuery || icon.includes(this.searchQuery)) {
        candidates.add(icon);
      }
    }

    candidates.forEach((iconName) => {
      const item = this.gridEl.createDiv({ cls: "tli-icon-modal-item" });
      const iconBox = item.createDiv();
      if (this.currentColor) {
        iconBox.style.color = this.currentColor;
      }
      setIcon(iconBox, iconName);

      // Only show if Obsidian actually rendered a valid SVG for this ID
      if (!iconBox.querySelector("svg")) {
        item.remove();
        return;
      }

      item.createDiv({ cls: "tli-icon-modal-name", text: iconName });
      item.addEventListener("click", () => {
        this.onSelect(iconName);
        this.close();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TasksLucideSettingTab extends PluginSettingTab {
  plugin: TasksLucidePlugin;

  constructor(app: App, plugin: TasksLucidePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Tasks Lucide Icons Settings" });

    // --- Mute Completed Tasks: pinned to the very top of the dialog ---
    // Lives outside the status section so it's the first thing you see.
    this.renderMuteToggle(containerEl);

    // --- Section 1: Core Task Emojis ---
    const coreBody = this.makeSection(
      "core",
      "Core Task Emoji Replacements",
      containerEl,
      (header) => {
        header.createEl("button", {
          text: "Reset All Core to Defaults"
        }).addEventListener("click", async () => {
          this.plugin.settings.coreRules = DEFAULT_CORE_RULES.map((r) => ({ ...r }));
          await this.plugin.saveSettings();
          this.display();
          new Notice("Core task icons and colors reset to defaults.");
        });
      }
    );

    coreBody.createDiv({
      cls: "tli-section-desc",
      text: "Customize the Lucide icon and color for each standard Tasks emoji. Core rules are built-in and cannot be deleted, but can be toggled or reset anytime."
    });

    const coreListEl = coreBody.createDiv({ cls: "tli-rule-list" });
    this.plugin.settings.coreRules.forEach((rule, index) => {
      this.renderRuleRow(coreListEl, rule, DEFAULT_CORE_RULES[index]);
    });

    // --- Section 2: Custom Regex Rules ---
    const customBody = this.makeSection(
      "custom",
      "Custom Regex Replacements & CSS Wrappers",
      containerEl
    );

    customBody.createDiv({
      cls: "tli-section-desc",
      text: "Define custom Regular Expressions (e.g., \\b\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}\\b, #urgent, or @Michael). Each rule can either replace the matched text with a Lucide icon OR wrap the matched text in a custom HTML tag / CSS class (e.g. <timeblock class=\"timeblock\">...</timeblock>) for styling in your CSS snippets."
    });

    const customListEl = customBody.createDiv({ cls: "tli-rule-list" });
    if (this.plugin.settings.customRules.length === 0) {
      const emptyEl = customListEl.createDiv({
        cls: "tli-section-desc",
        text: "No custom regex rules yet. Click '+ Add Regex Match' below to create one."
      });
      emptyEl.style.fontStyle = "italic";
    } else {
      this.plugin.settings.customRules.forEach((rule, idx) => {
        this.renderRuleRow(customListEl, rule, undefined, async () => {
          this.plugin.settings.customRules.splice(idx, 1);
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }

    // Add button lives at the bottom of the fold, after the rule list,
    // so the reading order is: list of rules, then how to add one.
    const customFooter = customBody.createDiv({ cls: "tli-section-footer" });
    customFooter.createEl("button", {
      cls: "mod-cta",
      text: "+ Add Regex Match"
    }).addEventListener("click", async () => {
      this.plugin.settings.customRules.push({
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: "Custom Rule",
        pattern: "@\\w+",
        isRegex: true,
        mode: "icon",
        cssClass: "timeblock",
        icon: "user",
        color: "#10b981",
        scale: 1,
        enabled: true,
        isCore: false
      });
      await this.plugin.saveSettings();
      this.display();
    });

    this.renderStatusIconSection(containerEl);
  }

  /**
   * Build a collapsible <details> section. Returns the body element to
   * fill. Open state is remembered in plugin.sectionCollapsed (display()
   * re-renders rebuild the DOM, so without this every toggle interaction
   * would snap every section back open).
   */
  private makeSection(
    key: string,
    title: string,
    parentEl: HTMLElement,
    onHeader?: (actionsEl: HTMLElement) => void
  ): HTMLElement {
    const details = parentEl.createEl("details", {
      cls: "tli-collapse"
    });
    details.open = !this.plugin.sectionCollapsed[key];

    const summary = details.createEl("summary", { cls: "tli-collapse-summary" });
    const chevron = summary.createSpan({ cls: "tli-collapse-chevron" });
    setIcon(chevron, "chevron-right");
    chevron.setAttr("aria-hidden", "true");
    summary.createSpan({ cls: "tli-collapse-title", text: title });

    if (onHeader) {
      const actionsEl = summary.createDiv({ cls: "tli-collapse-actions" });
      onHeader(actionsEl);
      // Header buttons must not toggle the fold when clicked.
      actionsEl.addEventListener("click", (ev) => ev.stopPropagation());
    }

    const body = details.createDiv({ cls: "tli-collapse-body" });

    details.addEventListener("toggle", () => {
      this.plugin.sectionCollapsed[key] = !details.open;
    });

    return body;
  }

  /** Mute completed tasks — rendered first, above every other setting. */
  private renderMuteToggle(containerEl: HTMLElement) {
    const s = this.plugin.settings.statusIcons;
    new Setting(containerEl)
      .setName("Mute completed tasks")
      .setDesc("Grey out and fade [x] tasks, including their icons and emoji.")
      .addToggle((t) =>
        t.setValue(s.muteCompleted).onChange(async (v) => {
          s.muteCompleted = v;
          await this.plugin.saveStatusSettings();
        })
      );
  }

  /**
   * Section 3: checkbox status glyphs + completed-task muting (formerly the
   * task-icons.css and completed-tasks-gray.css snippets). Colors use
   * Obsidian's native color picker; "reset" returns a status to its theme color.
   */
  private renderStatusIconSection(containerEl: HTMLElement) {
    const s = this.plugin.settings.statusIcons;

    // Collapsible section with the same card chrome as the others.
    const statusBody = this.makeSection("status", "Checkbox Status Icons", containerEl);

    statusBody.createDiv({
      cls: "tli-section-desc",
      text: "Replaces each alternate checkbox status ([x], [/], [!], [?], ...) with a colored icon. Colors default to your theme palette; pick a color to override, or reset to go back to the theme."
    });

    new Setting(statusBody)
      .setName("Enable status icons")
      .setDesc("Show a glyph instead of the plain checkbox for alternate statuses. Plain [ ] tasks keep their square.")
      .addToggle((t) =>
        t.setValue(s.enabled).onChange(async (v) => {
          s.enabled = v;
          await this.plugin.saveStatusSettings();
          this.display();
        })
      );

    if (!s.enabled) return;

    const bodyStyle = getComputedStyle(document.body);
    // Two status cards per row keeps this long section compact.
    const statusListEl = statusBody.createDiv({ cls: "tli-status-grid" });

    for (const def of STATUS_DEFS) {
      const custom = s.colors[def.key];
      const themeHex = cssColorToHex(bodyStyle.getPropertyValue(def.themeVar));

      // Status rows use the same card chrome as the replacement rules
      // (badge | pattern | color | actions) so the settings stay uniform.
      const card = statusListEl.createDiv({ cls: "tli-rule-card is-status-mode" });

      // 1. Badge: the exact glyph this status turns in to — borderless,
      //    just the colored mark (same mask vars as real checkboxes).
      const previewBadge = card.createDiv({ cls: "tli-preview-badge" });
      previewBadge.createSpan({
        cls: "tli-status-preview",
        attr: { "data-task": def.chars.split(" ")[0] }
      });

      // 2. Pattern / label column: [char] label, then theme-color note.
      const patternCol = card.createDiv({ cls: "tli-pattern-col" });
      const titleRow = patternCol.createDiv({ cls: "tli-core-title" });
      titleRow.createSpan({ cls: "tli-core-emoji", text: `[${def.chars.split(" ").join("] [")}]` });
      titleRow.createSpan({ text: def.label });
      patternCol.createDiv({
        cls: "tli-core-sub",
        text: custom ? `Custom color (theme: ${def.themeVar})` : `Theme color (${def.themeVar})`
      });

      // 3. Color picker.
      const colorCol = card.createDiv({ cls: "tli-color-col" });
      const colorPicker = colorCol.createEl("input", {
        type: "color",
        attr: { "aria-label": `Choose color for ${def.label}` }
      });
      colorPicker.value = custom ?? themeHex;
      colorPicker.addEventListener("input", async () => {
        s.colors[def.key] = colorPicker.value;
        await this.plugin.saveStatusSettings();
      });

      // 4. Reset to theme color (only enabled when a custom color exists).
      const actionsCol = card.createDiv({ cls: "tli-actions-col" });
      const resetBtn = actionsCol.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": "Reset to theme color" }
      });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.disabled = !custom;
      resetBtn.addEventListener("click", async () => {
        delete s.colors[def.key];
        await this.plugin.saveStatusSettings();
        this.display();
      });
    }
  }

  private renderRuleRow(
    parentEl: HTMLElement,
    rule: ReplacementRule,
    defaultRule?: ReplacementRule,
    onDelete?: () => void
  ) {
    const isCssMode = () => !rule.isCore && rule.mode === "css";

    const card = parentEl.createDiv({
      cls: `tli-rule-card ${!rule.enabled ? "is-disabled" : ""} ${isCssMode() ? "is-css-mode" : ""}`
    });

    // 1. Live Preview Badge (shows icon in icon mode, or </> code icon in CSS mode)
    const previewBadge = card.createDiv({ cls: "tli-preview-badge" });
    const updateBadge = () => {
      previewBadge.empty();
      if (isCssMode()) {
        previewBadge.style.color = "var(--text-accent)";
        previewBadge.style.setProperty("--tli-icon-scale", "1.15");
        previewBadge.setAttribute("aria-label", "CSS Class Wrapper mode");
        setIcon(previewBadge, "code-2");
        if (!previewBadge.querySelector("svg")) {
          setIcon(previewBadge, "code");
        }
        return;
      }
      previewBadge.style.color = rule.color;
      previewBadge.style.setProperty(
        "--tli-icon-scale",
        String(clampScale(rule.scale))
      );
      previewBadge.setAttribute("aria-label", `Icon: ${rule.icon}`);
      setIcon(previewBadge, rule.icon);
      if (!previewBadge.querySelector("svg")) {
        setIcon(previewBadge, "circle-help");
      }
    };
    updateBadge();

    // 2. Pattern / Label Column (+ Mode Toggle for Custom Rules)
    const patternCol = card.createDiv({ cls: "tli-pattern-col" });
    if (rule.isCore) {
      const titleRow = patternCol.createDiv({ cls: "tli-core-title" });
      titleRow.createSpan({ cls: "tli-core-emoji", text: rule.pattern });
      titleRow.createSpan({ text: rule.label });
    } else {
      const inputsWrap = patternCol.createDiv({ cls: "tli-custom-inputs" });

      // Mode Toggle: Icon vs CSS Class (full top row above regex input)
      const modeSwitch = inputsWrap.createDiv({
        cls: "tli-mode-switch",
        attr: { "aria-label": "Toggle between Lucide Icon replacement and CSS Class wrapping" }
      });
      const iconModeBtn = modeSwitch.createEl("button", {
        type: "button",
        cls: `tli-mode-btn ${!isCssMode() ? "is-active" : ""}`,
        text: "Icon",
        attr: { "aria-label": "Replace matched text with a Lucide icon" }
      });
      const cssModeBtn = modeSwitch.createEl("button", {
        type: "button",
        cls: `tli-mode-btn ${isCssMode() ? "is-active" : ""}`,
        text: "CSS Class",
        attr: { "aria-label": "Wrap matched text in a custom HTML tag & CSS class" }
      });

      const regexInput = inputsWrap.createEl("input", {
        type: "text",
        cls: "tli-regex-input",
        placeholder: "Regex pattern (e.g. \\b\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}\\b)"
      });
      regexInput.value = rule.pattern;

      const errorMsg = inputsWrap.createDiv({
        cls: "tli-regex-error",
        text: "Invalid regular expression"
      });

      const validateRegex = (val: string): boolean => {
        if (!val.trim()) return false;
        try {
          new RegExp(val, "g");
          regexInput.classList.remove("is-invalid");
          errorMsg.classList.remove("tli-regex-Error-visible");
          return true;
        } catch {
          regexInput.classList.add("is-invalid");
          errorMsg.classList.add("tli-regex-Error-visible");
          return false;
        }
      };

      validateRegex(rule.pattern);

      regexInput.addEventListener("input", async () => {
        rule.pattern = regexInput.value;
        if (validateRegex(rule.pattern)) {
          await this.plugin.saveSettings();
        }
      });

      const applyModeUI = () => {
        const cssActive = isCssMode();
        card.toggleClass("is-css-mode", cssActive);
        iconModeBtn.toggleClass("is-active", !cssActive);
        cssModeBtn.toggleClass("is-active", cssActive);
        updateBadge();
      };

      iconModeBtn.addEventListener("click", async () => {
        if (rule.mode !== "icon") {
          rule.mode = "icon";
          applyModeUI();
          await this.plugin.saveSettings();
        }
      });

      cssModeBtn.addEventListener("click", async () => {
        if (rule.mode !== "css") {
          rule.mode = "css";
          if (!rule.cssClass || !rule.cssClass.trim()) {
            rule.cssClass = "timeblock";
          }
          applyModeUI();
          updateCssPreview();
          if (cssClassInput) {
            cssClassInput.value = rule.cssClass;
          }
          await this.plugin.saveSettings();
        }
      });
    }

    // 3. Lucide Icon Input + Browse Modal Button (shown in Icon mode)
    const iconCol = card.createDiv({ cls: "tli-icon-col" });
    const iconInput = iconCol.createEl("input", {
      type: "text",
      placeholder: "Lucide icon name..."
    });
    iconInput.value = rule.icon;

    iconInput.addEventListener("input", async () => {
      rule.icon = iconInput.value.trim().toLowerCase();
      updateBadge();
      await this.plugin.saveSettings();
    });

    const browseBtn = iconCol.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Browse Lucide icons" }
    });
    setIcon(browseBtn, "search");
    browseBtn.addEventListener("click", () => {
      new LucideIconPickerModal(
        this.app,
        rule.icon,
        rule.color,
        async (chosenIcon) => {
          rule.icon = chosenIcon;
          iconInput.value = chosenIcon;
          updateBadge();
          await this.plugin.saveSettings();
        }
      ).open();
    });

    // 4. Size (custom rules only, Icon mode): per-rule scaling factor.
    const sizeCol = card.createDiv({ cls: "tli-size-col" });
    if (!rule.isCore) {
      const sizeHeader = sizeCol.createDiv({ cls: "tli-size-header" });
      sizeHeader.createSpan({ cls: "tli-size-label", text: "Size" });
      const sizeValue = sizeHeader.createSpan({ cls: "tli-size-value" });
      const scaleInput = sizeCol.createEl("input", {
        type: "range",
        cls: "tli-scale-slider",
        attr: {
          min: String(CUSTOM_SCALE_MIN),
          max: String(CUSTOM_SCALE_MAX),
          step: "0.05",
          "aria-label": "Icon size scaling factor"
        }
      });

      const updateSizeDisplay = () => {
        const scale = clampScale(rule.scale);
        scaleInput.value = String(scale);
        sizeValue.textContent = `${scale.toFixed(2)}x · ${Math.round(14 * scale)}px`;
      };
      updateSizeDisplay();

      scaleInput.addEventListener("input", async () => {
        rule.scale = clampScale(parseFloat(scaleInput.value));
        updateSizeDisplay();
        if (!isCssMode()) {
          previewBadge.style.setProperty(
            "--tli-icon-scale",
            String(rule.scale)
          );
        }
        await this.plugin.saveSettings();
      });
    }

    // 5. Color Picker (Icon mode)
    const colorCol = card.createDiv({ cls: "tli-color-col" });
    const colorPicker = colorCol.createEl("input", {
      type: "color",
      attr: { "aria-label": "Choose icon color" }
    });
    colorPicker.value = rule.color.startsWith("#") ? rule.color : "#3b82f6";

    colorPicker.addEventListener("input", async () => {
      rule.color = colorPicker.value;
      updateBadge();
      await this.plugin.saveSettings();
    });

    // 5b. CSS Class / Tag Wrapper Column (shown when rule.mode === "css")
    let cssClassInput: HTMLInputElement | null = null;
    let updateCssPreview = () => {};
    if (!rule.isCore) {
      const cssCol = card.createDiv({ cls: "tli-css-col" });
      cssClassInput = cssCol.createEl("input", {
        type: "text",
        cls: "tli-css-class-input",
        placeholder: "CSS class / tag name (e.g. timeblock)"
      });
      cssClassInput.value = rule.cssClass ?? "";

      const cssHint = cssCol.createDiv({ cls: "tli-css-hint" });
      updateCssPreview = () => {
        const { tagName, cleanTokens } = parseCssWrapTarget(rule.cssClass);
        if (cleanTokens.length === 0) {
          cssHint.textContent = "Enter a class/tag name (e.g. timeblock)";
          cssHint.removeAttribute("title");
          return;
        }
        const clsAttr = cleanTokens.join(" ");
        const domSnippet = `DOM: <${tagName} class="${clsAttr}">match</${tagName}>`;
        cssHint.textContent = domSnippet;
        cssHint.setAttribute(
          "title",
          `${domSnippet} · Target in CSS with .${cleanTokens[0]} or ${tagName}`
        );
      };
      updateCssPreview();

      cssClassInput.addEventListener("input", async () => {
        rule.cssClass = cssClassInput!.value;
        updateCssPreview();
        await this.plugin.saveSettings();
      });
    }

    // 6. Actions: Toggle + Reset (Core) or Delete (Custom)
    const actionsCol = card.createDiv({ cls: "tli-actions-col" });

    const toggle = actionsCol.createEl("input", {
      type: "checkbox",
      attr: { "aria-label": "Enable/Disable replacement" }
    });
    toggle.checked = rule.enabled;
    toggle.addEventListener("change", async () => {
      rule.enabled = toggle.checked;
      card.toggleClass("is-disabled", !rule.enabled);
      await this.plugin.saveSettings();
    });

    if (rule.isCore && defaultRule) {
      const resetBtn = actionsCol.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": "Reset this core rule to default icon & color" }
      });
      setIcon(resetBtn, "rotate-ccw");
      resetBtn.addEventListener("click", async () => {
        rule.icon = defaultRule.icon;
        rule.color = defaultRule.color;
        rule.enabled = true;
        iconInput.value = rule.icon;
        colorPicker.value = rule.color;
        toggle.checked = true;
        card.removeClass("is-disabled");
        updateBadge();
        await this.plugin.saveSettings();
      });
    } else if (!rule.isCore && onDelete) {
      const deleteBtn = actionsCol.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": "Remove custom regex rule" }
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.style.color = "var(--text-error)";
      deleteBtn.addEventListener("click", () => onDelete());
    }
  }
}
