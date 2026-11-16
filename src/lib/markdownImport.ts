// Reads a checklist from Obsidian or Notes (Markdown) into Milo's three levels: a heading is a
// part of the course, a list item is a to-do, an item indented under it is a step. Deeper
// items become steps of the same to-do. Plain text outside lists is left out.

export interface MdStep {
  title: string;
  done: boolean;
}
export interface MdTodo {
  title: string;
  done: boolean;
  /** The heading it stood under, if any. */
  section: string | null;
  steps: MdStep[];
}
export interface MdImport {
  todos: MdTodo[];
  sections: string[];
  /** Lines with text that were not a heading or a list item. */
  skipped: number;
}

/** Markdown decoration away: [[link|alias]] → alias, [text](url) → text, **bold** → bold. */
export function plainText(s: string): string {
  return s
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^*\w])[*_]([^*_]+)[*_](?=[^*\w]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX/-])\]\s*)?(.*)$/;

/** The indent of a line in columns (a tab counts as four spaces). */
const indentOf = (s: string) => s.replace(/\t/g, "    ").length;

export function parseMarkdown(text: string): MdImport {
  const todos: MdTodo[] = [];
  const sections: string[] = [];
  let section: string | null = null;
  let skipped = 0;
  let base: number | null = null; // the indent of a to-do in the current list
  let inFence = false;

  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !raw.trim() || /^\s*(---|\*\*\*|___)\s*$/.test(raw)) continue;

    const h = HEADING.exec(raw);
    if (h) {
      const name = plainText(h[2]);
      if (name) {
        section = name;
        if (!sections.includes(name)) sections.push(name);
      }
      base = null;
      continue;
    }

    const m = ITEM.exec(raw);
    if (!m) {
      skipped++;
      continue;
    }
    const indent = indentOf(m[1]);
    const done = m[2] === "x" || m[2] === "X";
    const title = plainText(m[3]);
    if (!title) continue;
    if (base === null || indent <= base || !todos.length) {
      base = indent;
      todos.push({ title, done, section, steps: [] });
    } else {
      todos[todos.length - 1].steps.push({ title, done });
    }
  }
  // A to-do ticked off as a whole is done with all its steps.
  for (const t of todos) if (t.done) t.steps.forEach((s) => (s.done = true));
  return { todos, sections: sections.filter((s) => todos.some((t) => t.section === s)), skipped };
}
