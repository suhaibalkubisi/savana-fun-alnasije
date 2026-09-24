export function scopedResult<T>(
  result: { data?: T; query?: string; key: string; error: string },
  query: string,
  key: string,
  enabled: boolean,
): { data?: T; loading: boolean; refreshing: boolean; error: string };
export function singleFlight(): <T>(
  key: string,
  run: () => Promise<T>,
) => Promise<T>;
