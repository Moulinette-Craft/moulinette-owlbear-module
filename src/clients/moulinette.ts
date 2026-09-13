import { MOU_API } from "../constants";
import { getSessionId } from "../storage";

const HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

async function request(uri: string, method: "GET" | "POST", params?: Record<string, string>, body?: unknown) {
  const query = params
    ? "?" +
      Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  const response = await fetch(`${MOU_API}${uri}${query}`, {
    method,
    headers: HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Moulinette API error: HTTP ${response.status} on ${uri}`);
  }
  return response.json();
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
