// Transient drops (wifi blips, sleep/wake, brief server hiccups) surface as
// fetch() rejecting before any response is received — distinct from a
// completed HTTP error response, which callers handle themselves and this
// never retries. A couple of quiet retries lets in-progress work (a practice
// session, a background token refresh) survive a momentary disconnect
// instead of failing on the first blip.
const NETWORK_RETRY_DELAYS_MS = [500, 1500];

export async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= NETWORK_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[attempt]));
    }
  }
}
