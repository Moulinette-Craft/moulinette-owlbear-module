import { AdvancedSettings, DEFAULT_ADVANCED_SETTINGS, LS_SESSION_ID, LS_SETTINGS } from "./constants";

/**
 * All persisted state lives in this browser's localStorage rather than in Owlbear's
 * room/player metadata. Player metadata in Owlbear Rodeo is broadcast to every other
 * connected player (it's how presence/cursor-color style features work), so storing
 * a Moulinette session token there would leak it to everyone else in the room -
 * localStorage keeps it private to this device, matching how the FoundryVTT module
 * keeps it in a GM-only world setting.
 */

export function getSessionId(): string {
  return localStorage.getItem(LS_SESSION_ID) || "anonymous";
}

export function setSessionId(id: string): void {
  localStorage.setItem(LS_SESSION_ID, id);
}

export function clearSession(): void {
  localStorage.removeItem(LS_SESSION_ID);
}

export function getAdvancedSettings(): AdvancedSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return structuredClone(DEFAULT_ADVANCED_SETTINGS);
    const parsed = JSON.parse(raw);
    return { image: { ...DEFAULT_ADVANCED_SETTINGS.image, ...parsed.image } };
  } catch {
    return structuredClone(DEFAULT_ADVANCED_SETTINGS);
  }
}

export function setAdvancedSettings(settings: AdvancedSettings): void {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
}
