// Browser-session cache: keep completed data and share requests across panel
// remounts. A failed refresh retains the last successful value for rendering.
export function createRequestCache<T>(limit = 20, maxAge = 60000) {
  const entries = new Map<string, { value?: T; updatedAt: number; request?: Promise<T> }>();

  return {
    peek(key: string) {
      return entries.get(key)?.value;
    },
    invalidate() {
      for (const entry of entries.values()) {
        entry.updatedAt = -Infinity;
        entry.request = undefined;
      }
    },
    read(key: string, fetch: () => Promise<T>, force = false): Promise<T> {
      const entry = entries.get(key) ?? { updatedAt: -Infinity };
      entries.delete(key);
      entries.set(key, entry);

      if (entries.size > limit) entries.delete(entries.keys().next().value!);

      if (entry.request) return entry.request;

      if (!force && entry.value !== undefined && Date.now() - entry.updatedAt < maxAge)
        return Promise.resolve(entry.value);
      const request = Promise.resolve().then(fetch);
      entry.request = request;
      void request.then(
        (value) => {
          if (entry.request !== request) return;
          entry.value = value;
          entry.updatedAt = Date.now();
          entry.request = undefined;
        },
        () => {
          if (entry.request === request) {
            entry.updatedAt = -Infinity;
            entry.request = undefined;
          }
        },
      );

      return request;
    },
  };
}
