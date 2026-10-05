/**
 * Sound-effect playback needs to keep going after the user closes the
 * fullscreen browser modal (src/ui/browser.ts) - but that modal's iframe is
 * destroyed on close, like any OBR.modal. The toolbar action's popover
 * (action.html/src/action.ts) is the only extension surface Owlbear keeps
 * loaded for the whole room session instead of recreating on every open (see
 * the comment on OBR.action.onOpenChange in src/action.ts), so the actual
 * <audio> elements live there instead, and the browser UI controls them
 * remotely through this same-tab BroadcastChannel.
 *
 * This is deliberately a plain Web API channel, not OBR.broadcast: that's a
 * room-wide messaging primitive (other players' clients), and would need
 * every call site to remember to pass `{ destination: "LOCAL" }` to avoid
 * leaking playback control to the room - a same-tab BroadcastChannel can't
 * leave the tab in the first place. Playback here is always local-only, never
 * synced to other players (see README).
 *
 * Two independent playback "groups" share the host, each with its own rules:
 *  - "preview" is the single-sound quick-audition player used by the normal
 *    asset grid (BBC Sound Effects, Moulinette Cloud audio row) - starting a
 *    new preview stops whatever preview was playing before, like a single
 *    <audio> element always did.
 *  - "soundboard" is the dedicated multi-track soundboard (src/ui/soundboard.ts)
 *    - any number of tracks can play at once, each independently
 *    stoppable/volume-adjustable, and starting one never touches another.
 * A preview and a soundboard track can play at the same time (e.g. previewing
 * a BBC effect while ambience from the soundboard keeps going).
 */

const CHANNEL_NAME = "moulinette-audio";

export type AudioGroup = "preview" | "soundboard";

export type AudioBridgeMessage =
  /** `loop` only ever applies to the "soundboard" group - a "preview" track always plays once, like a quick audition should. */
  | { type: "play"; group: AudioGroup; assetId: string; url: string; volume?: number; loop?: boolean }
  | { type: "stop"; group: AudioGroup; assetId: string }
  | { type: "set-volume"; group: "soundboard"; assetId: string; volume: number }
  /** Sent by a freshly (re)opened modal to learn what's already playing, if anything. */
  | { type: "get-state" }
  /**
   * Sent by the host (action.html) whenever playback starts, stops, or ends
   * on its own. `hostId` identifies which host instance sent it - a random id
   * generated once per `initAudioHost()` call, included so a client can lock
   * onto a single instance and ignore any other (stray/duplicate) one. That
   * matters because Owlbear is only *expected* to keep one popover iframe
   * alive for the whole room session (see the comment in action.ts) - if that
   * ever doesn't hold and two end up running at once, each with its own
   * BroadcastChannel and its own <audio> elements, a client naively trusting
   * whichever "state" arrives last would flap between two different, equally
   * "valid"-looking truths - e.g. one instance's playback succeeding while
   * the other's fails, each broadcasting a different answer for the same
   * assetId within milliseconds of each other.
   */
  | { type: "state"; hostId: string; preview: string | null; soundboard: { assetId: string; volume: number }[] };

export function openAudioChannel(): BroadcastChannel {
  return new BroadcastChannel(CHANNEL_NAME);
}
