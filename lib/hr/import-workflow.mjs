export function currentImport(selected, loaded) {
  if (!selected) return loaded || null;
  if (!loaded || loaded.id !== selected?.id) return selected;
  if (
    selected.version > loaded.version ||
    (selected.lifecycle_version || 0) > (loaded.lifecycle_version || 0)
  )
    return selected;
  return loaded;
}
export function importActionVersion(batch, action) {
  return action === "review" || action === "approve"
    ? batch.lifecycle_version
    : batch.version;
}
