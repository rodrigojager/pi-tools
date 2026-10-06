# pi-prose-spacing-guard

A small Pi extension that catches strongly suspicious joined prose in task handoffs before it reaches a subagent.

It checks `write` calls for Markdown/text files under `task(s)/` or `handoff(s)/`, and `subagent` calls with a long direct task or a local `ticketPath`. A dense cluster of long lowercase words blocks the call and asks the agent to rewrite it. The extension never edits text automatically, so identifiers, paths, and hashes remain untouched. Code fences, inline code, and URLs are excluded from the heuristic.

The guard is deliberately conservative: it can miss short or subtle errors, and it does not rewrite ordinary assistant chat. It protects handoffs, where missing spaces can change a child agent's instructions. Existing running Pi sessions keep their loaded extensions until reloaded.

Install as a local Pi package by adding its directory to `~/.pi/agent/settings.json` `packages`. Run `npm test` to verify the detector.
