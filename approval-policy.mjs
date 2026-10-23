/** Read only the latest goal state on the current session branch. */
export function hasActiveGoal(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === "custom" && entry.customType === "goal-state") {
      const goal = entry.data?.goal;
      return goal?.status === "active" && typeof goal.id === "string" && goal.id.length > 0;
    }
  }
  return false;
}

/** Share the policy through Pi's shared extension UI, without replacing packages. */
export function createConfirmationPolicy() {
  const installed = new Map();
  return {
    install(ui, readBranch) {
      const existing = installed.get(ui);
      if (existing && ui.confirm === existing.wrapper) {
        existing.readBranch = readBranch;
        return;
      }
      const original = ui.confirm;
      const record = { original, readBranch, enabled: true, wrapper: undefined };
      record.wrapper = async (...args) => {
        if (record.enabled && hasActiveGoal(record.readBranch())) return true;
        return Reflect.apply(original, ui, args);
      };
      installed.set(ui, record);
      ui.confirm = record.wrapper;
    },
    dispose() {
      for (const [ui, record] of installed) {
        record.enabled = false;
        if (ui.confirm === record.wrapper) ui.confirm = record.original;
      }
      installed.clear();
    },
  };
}
