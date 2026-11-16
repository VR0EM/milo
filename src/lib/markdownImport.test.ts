import { describe, expect, it } from "vitest";
import { parseMarkdown, plainText } from "./markdownImport";

describe("parseMarkdown", () => {
  it("reads headings, to-dos with their state, and steps", () => {
    const md = [
      "# Enterprise Networking",
      "Some notes about the course.",
      "## 01 VLANs",
      "- [x] Read chapter 1",
      "- [ ] Lab 1",
      "\t- [x] Topology",
      "\t- [ ] Configuration",
      "\t\t- [ ] Trunks",
      "## 02 Routing",
      "- [ ] Exercises OSPF",
    ].join("\n");
    const r = parseMarkdown(md);
    expect(r.sections).toEqual(["01 VLANs", "02 Routing"]);
    expect(r.skipped).toBe(1);
    expect(r.todos).toEqual([
      { title: "Read chapter 1", done: true, section: "01 VLANs", steps: [] },
      {
        title: "Lab 1", done: false, section: "01 VLANs",
        steps: [{ title: "Topology", done: true }, { title: "Configuration", done: false }, { title: "Trunks", done: false }],
      },
      { title: "Exercises OSPF", done: false, section: "02 Routing", steps: [] },
    ]);
  });

  it("takes plain bullets, numbered items and spaces as indent", () => {
    const r = parseMarkdown("1. Groceries\n    * milk\n    * bread\n2) Call mom\n+ Pay rent");
    expect(r.todos.map((t) => [t.title, t.steps.length])).toEqual([["Groceries", 2], ["Call mom", 0], ["Pay rent", 0]]);
  });

  it("a to-do done as a whole has all its steps done", () => {
    const r = parseMarkdown("- [x] Project\n  - [ ] part a\n  - [ ] part b");
    expect(r.todos[0].steps.every((s) => s.done)).toBe(true);
  });

  it("leaves out code blocks, rules and empty items, and keeps headings without items out", () => {
    const r = parseMarkdown("## Empty\n```\n- [ ] not a todo\n```\n---\n- [ ]   \n## Real\n- [ ] yes");
    expect(r.todos.map((t) => t.title)).toEqual(["yes"]);
    expect(r.sections).toEqual(["Real"]);
  });
});

describe("plainText", () => {
  it("drops Markdown decoration", () => {
    expect(plainText("Read [[Chapter 4|chapter four]] and **notes** from [site](https://x.y) `code`")).toBe("Read chapter four and notes from site code");
    expect(plainText("[[Lab 3]] ~~old~~ _done_")).toBe("Lab 3 old done");
  });
});
