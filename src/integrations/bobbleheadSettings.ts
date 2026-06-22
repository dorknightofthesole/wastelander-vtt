import { MODULE_ID } from "../constants.js";

export const BOBBLEHEAD_SETTINGS = {
  imageVisibility: "bobbleheadImageVisibility",
} as const;

export type BobbleheadImageVisibility = "everyone" | "gmAndOwner";

export function registerBobbleheadSettings(): void {
  const settings = (game as { settings?: { register: (...args: unknown[]) => void } })
    .settings;
  if (!settings?.register) return;

  settings.register(MODULE_ID, BOBBLEHEAD_SETTINGS.imageVisibility, {
    name: "WASTELANDER.Bobblehead.Settings.ShowBobbleheads",
    hint: "WASTELANDER.Bobblehead.Settings.ShowBobbleheadsHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      everyone: "WASTELANDER.Bobblehead.Settings.ShowBobbleheadsEveryone",
      gmAndOwner: "WASTELANDER.Bobblehead.Settings.ShowBobbleheadsGmAndOwner",
    },
    default: "gmAndOwner",
  });
}

export function getBobbleheadImageVisibility(): BobbleheadImageVisibility {
  const value = game.settings.get(MODULE_ID, BOBBLEHEAD_SETTINGS.imageVisibility);
  return value === "everyone" ? "everyone" : "gmAndOwner";
}

export function shouldShowBobbleheadImage(actor: Actor): boolean {
  if (getBobbleheadImageVisibility() === "everyone") return true;
  return game.user.isGM || actor.isOwner;
}
