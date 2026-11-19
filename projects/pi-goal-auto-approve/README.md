# Pi goal automatic approvals

User-authorized policy for `@narumitw/pi-goal` on Pi 1.0.0.

While the latest `goal-state` on the current session branch has status `active`,
every extension `ctx.ui.confirm(...)` returns `true` immediately, including
`Run project-local agent?`. The model also receives the user's authorization to
complete the current objective without action approval requests.

The current branch is checked on every confirmation. Paused, blocked, completed,
cleared, usage-limited and budget-limited goals use the original confirmation UI.
Session shutdown restores the original method. Information entry, selectors and
custom editors keep their normal behavior; they do not have a generic approval
answer. This does not alter OS dialogs or permission policies of external tools.

Install with `pi install git:github.com/rodrigojager/pi-goal-auto-approve`. In an
already open Pi session, run `/reload` to load it, preserving the current goal.
If a confirmation is already open, close it first. `/goal-approvals` shows the
current policy state.

Verification: `node --test tests/*.test.mjs` from this directory. Tests run against
the actual installed Pi extension loader and runner with an in-memory session;
they do not call a model or access credentials.

