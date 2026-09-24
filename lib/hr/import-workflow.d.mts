export function currentImport<
  T extends { id: string; version: number; lifecycle_version?: number },
>(selected: T | null, loaded?: T): T | null;
export function importActionVersion(
  batch: { version: number; lifecycle_version?: number },
  action: string,
): number | undefined;
