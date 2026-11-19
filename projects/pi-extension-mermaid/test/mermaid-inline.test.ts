import test from "node:test";
import assert from "node:assert/strict";

import { getCapabilities } from "@mariozechner/pi-tui";
import mermaidInlineExtension from "../mermaid.ts";

test("does not add a second ASCII diagram without terminal image support", async (t) => {
  if (getCapabilities().images) {
    t.skip("test requires a terminal without inline image support");
    return;
  }

  const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
  let renderer: ((message: unknown, options: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
  const sent: unknown[] = [];
  const pi = {
    on: (name: string, handler: (event: unknown) => Promise<unknown>) => handlers.set(name, handler),
    registerMessageRenderer: (_name: string, handler: typeof renderer) => { renderer = handler; },
    registerShortcut: () => {},
    registerCommand: () => {},
    sendMessage: (message: unknown) => sent.push(message),
  };

  await mermaidInlineExtension(pi as never);
  const code = "flowchart LR\nA --> B";
  await handlers.get("agent_end")!({
    messages: [{ role: "assistant", content: [{ type: "text", text: `\`\`\`mermaid\n${code}\n\`\`\`` }] }],
  });

  assert.deepEqual(sent, []);
  const component = renderer!({ details: { id: "diagram", block: { code } } }, {}, {});
  assert.deepEqual(component.render(80), []);
});
