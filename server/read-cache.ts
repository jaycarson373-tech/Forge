/** Bounded cache for display reads only. Transaction preparation never uses cached quotes. */
export class ReadCache {
  private values = new Map<string, { value: unknown; expires: number }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private capacity = 128) {}
  async get<T>(key: string, ttl: number, read: () => Promise<T>): Promise<T> {
    const existing = this.values.get(key);
    if (existing && existing.expires > Date.now()) return existing.value as T;
    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;
    const work = read()
      .then((value) => {
        if (this.values.size >= this.capacity) this.values.delete(this.values.keys().next().value!);
        this.values.set(key, { value, expires: Date.now() + ttl });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  clear() {
    this.values.clear();
  }
}
