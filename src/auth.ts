import { DISCORD_CLIENT_ID, MOU_SERVER_URL, PATREON_CLIENT_ID } from "./constants";
import { MoulinetteClient } from "./clients/moulinette";
import { clearSession, getSessionId, setSessionId } from "./storage";

function randomId(length = 26): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

export interface MoulinetteUser {
  patreon?: { name?: string; avatar?: string };
  discord?: { name?: string; avatar?: string };
  [key: string]: unknown;
}

export const Auth = {
  isConnected(): boolean {
    return getSessionId() !== "anonymous";
  },

  getUser(): Promise<MoulinetteUser | null> {
    return MoulinetteClient.getUser() as Promise<MoulinetteUser | null>;
  },

  disconnect(): void {
    clearSession();
  },

  /**
   * Opens the Patreon/Discord OAuth flow in a new tab (same client ids/callback
   * URLs as the FoundryVTT module, so both land on the same Moulinette account),
   * then polls until the resulting session is valid or `timeoutSeconds` elapses.
   */
  async connect(
    source: "patreon" | "discord",
    onTick: (secondsLeft: number) => void,
    timeoutSeconds = 120,
    checkEverySeconds = 2,
  ): Promise<boolean> {
    const sessionId = randomId();
    let authUrl: string;
    if (source === "patreon") {
      authUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${PATREON_CLIENT_ID}&redirect_uri=${MOU_SERVER_URL}/patreon/callback&scope=identity identity.memberships&state=${sessionId}`;
    } else {
      authUrl = `https://discord.com/oauth2/authorize?response_type=code&client_id=${DISCORD_CLIENT_ID}&scope=identify guilds guilds.members.read&redirect_uri=${MOU_SERVER_URL}/discord/callback&state=${sessionId}`;
    }

    setSessionId(sessionId);
    window.open(authUrl, "_blank");

    let secondsLeft = timeoutSeconds;
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        secondsLeft -= checkEverySeconds;
        onTick(Math.max(secondsLeft, 0));
        const valid = await MoulinetteClient.isSessionValid(sessionId, source);
        if (valid) {
          clearInterval(timer);
          resolve(true);
        } else if (secondsLeft <= 0) {
          clearInterval(timer);
          resolve(false);
        }
      }, checkEverySeconds * 1000);
    });
  },
};
