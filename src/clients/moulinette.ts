import { MOU_API } from "../constants";
import { getSessionId } from "../storage";
import { debugLog } from "../debug";

const HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

async function request(uri: string, method: "GET" | "POST", params?: Record<string, string>, body?: unknown) {
  const query = params
    ? "?" +
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  const url = `${MOU_API}${uri}${query}`;
  debugLog("MoulinetteClient:", method, url, body !== undefined ? "body:" : "", body ?? "");
  const response = await fetch(url, {
    method,
    headers: HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  debugLog("MoulinetteClient: response status", response.status, "for", url);
  if (!response.ok) {
    throw new Error(`Moulinette API error: HTTP ${response.status} on ${uri}`);
  }
  const json = await response.json();
  // Full response bodies (especially /all-assets, which can list thousands of
  // records) would flood the on-screen debug panel - log a bounded preview
  // instead of the raw object.
  const preview = JSON.stringify(json);
  debugLog("MoulinetteClient: response body for", uri, "=", preview.length > 500 ? `${preview.slice(0, 500)}… (${preview.length} chars total)` : preview);
  return json;
}

export const MoulinetteClient = {
  apiGET: (uri: string, params?: Record<string, string>) => request(uri, "GET", params),
  apiPOST: (uri: string, body: unknown, params?: Record<string, string>) => request(uri, "POST", params, body),

  async isSessionValid(sessionId: string, authSource: string): Promise<boolean> {
    try {
      const res = await request("/session/valid", "GET", {
        session: sessionId,
        source: authSource,
        ms: String(Date.now()),
      });
      return !!res?.valid;
    } catch (e) {
      console.error("Moulinette | Failed to validate session", e);
      return false;
    }
  },

  /** Fetches the connected user's profile. Returns null when not connected / on error. */
  async getUser(): Promise<Record<string, unknown> | null> {
    try {
      const res = await request("/user", "GET", { force: "0", session: getSessionId(), ms: String(Date.now()) });
      return res ?? null;
    } catch (e) {
      console.error("Moulinette | Failed to fetch user", e);
      return null;
    }
  },

  /** Full asset record (base_url, file_url, deps, ...) needed to actually resolve a download URL. */
  async getAsset(assetId: string): Promise<Record<string, any>> {
    return request(`/asset/${assetId}`, "GET", { session: getSessionId() });
  },

  /** Bulk list of every asset the current session can access (free assets + supported creators). */
  async getAllAssets(): Promise<{ assets: any[]; packs: Record<string, any> }> {
    return request("/all-assets", "POST", undefined, {
      scope: { session: getSessionId(), mode: "cloud-accessible" },
    });
  },
};
