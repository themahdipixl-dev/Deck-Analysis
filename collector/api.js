const DEFAULT_BASE_URL = "https://cr-rankings-api.themahdipixl.workers.dev";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data && data.items) ? data.items : [];
}

export function createApi(options = {}) {
  const baseUrl = options.baseUrl || process.env.WORKER_BASE_URL || DEFAULT_BASE_URL;
  const requestDelayMs = Number(options.requestDelayMs ?? process.env.REQUEST_DELAY_MS ?? 0);
  const retries = Number(options.retries || process.env.REQUEST_RETRIES || 4);
  let nextRequestAt = 0;

  async function request(path) {
    const now = Date.now();
    const wait = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(nextRequestAt, now) + Math.max(0, requestDelayMs);
    if (wait > 0) await sleep(wait);

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(baseUrl + path, {
          headers: { Accept: "application/json" },
        });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}

        if (response.ok) return data;

        const error = new Error(
          (data && (data.error || data.reason || data.message)) || ("HTTP " + response.status)
        );
        error.status = response.status;
        if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
      }

      await sleep(Math.min(30000, 2000 * Math.pow(2, attempt - 1)));
    }
    throw lastError || new Error("Request failed");
  }

  return {
    async fetchLocations() {
      return unwrapList(await request("/api/locations"));
    },

    async fetchTopPolPlayers(locationId, limit = 1000) {
      const safeLimit = Math.min(1000, Math.max(1, limit));
      if (!locationId) throw new Error("locationId is required");
      const data = await request(
        "/api/pathoflegend?locationId=" +
          encodeURIComponent(String(locationId)) +
          "&limit=" +
          safeLimit
      );
      return unwrapList(data);
    },

    async fetchBattlelog(tag) {
      const data = await request(
        "/api/player/" + encodeURIComponent(String(tag)) + "/battlelog"
      );
      return Array.isArray(data) ? data : unwrapList(data);
    },
  };
}
