/**
 * Sound-effect playback needs to keep going after the user closes the
 * fullscreen browser modal (src/ui/browser.ts) - but that modal's iframe is
 * destroyed on close, like any OBR.modal. The toolbar action's popover
 * (action.html/src/action.ts) is the only extension surface Owlbear keeps
 * loaded for the whole room session instead of recreating on every open (see
 * the comment on OBR.action.onOpenChange in src/action.ts), so the actual
 * <audio> element lives there instead, and the browser UI controls it
 * remotely through this same-tab BroadcastChannel.
 *
 * This is deliberately a plain Web API channel, not OBR.broadcast: that's a
 * room-wide messaging primitive (other players' clients), and would need
 * every call site to remember to pass `{ destination: "LOCAL" }` to avoid
 * leaking playback control to the room - a same-tab BroadcastChannel can't
 * leave the tab in the first place.
 */

const CHANNEL_NAME = "moulinette-audio";

export type AudioBridgeMessage =
  | { type: "play"; assetId: string; url: string }
  | { type: "stop" }
  /** Sent by a freshly (re)opened modal to learn what's already playing, if anything. */
  | { type: "get-state" }
  /** Sent by the host (action.html) whenever playback starts, stops, or ends on its own. */
  | { type: "state"; assetId: string | null };

export function openAudioChannel(): BroadcastChannel {
  return new BroadcastChannel(CHANNEL_NAME);
}
