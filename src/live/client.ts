export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function liveApi<T>(
  path: string,
  data?: unknown,
  token = '',
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/live/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('The server could not be reached. Check your connection and try again.');
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      'The server returned an invalid response. Check that the API is running.',
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      (result as { error?: string })?.error || `Request failed (${response.status}).`,
      response.status,
    );
  return result as T;
}
export class WalletSession {
  private token = '';
  private expires = 0;
  private wallet = '';
  private generation = 0;
  clear() {
    this.token = '';
    this.expires = 0;
    this.wallet = '';
    this.generation++;
  }
  async get(
    wallet: string,
    login: () => Promise<{ token: string; wallet: string; expires: number }>,
  ) {
    if (this.wallet === wallet && this.token && Date.now() < this.expires - 15000)
      return this.token;
    const generation = this.generation;
    const result = await login();
    if (generation !== this.generation || result.wallet !== wallet)
      throw new Error('Wallet changed during sign-in. Connect again.');
    this.wallet = wallet;
    this.token = result.token;
    this.expires = result.expires;
    return result.token;
  }
}
