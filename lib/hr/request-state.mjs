// Never display/export data fetched for a different filter scope.
export function scopedResult(result, query, key, enabled) {
  const sameQuery = enabled && result.query === query;
  const pending = enabled && result.key !== key;
  return {
    data: sameQuery ? result.data : undefined,
    loading: pending && (!sameQuery || result.data === undefined),
    refreshing: pending && sameQuery && result.data !== undefined,
    error: enabled && result.key === key ? result.error : "",
  };
}

// Share only identical in-flight mutations. Never retry or cache a write result.
export function singleFlight() {
  const pending = new Map();
  return (key, run) => {
    if (pending.has(key)) return pending.get(key);
    const promise = Promise.resolve()
      .then(run)
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
