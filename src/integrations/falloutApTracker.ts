const FALLOUT_SYSTEM_ID = "fallout";

type ApPool = "partyAP" | "gmAP";

type APTrackerStatic = {
  adjustAP?: (type: ApPool, diff: number) => Promise<void>;
  setAP?: (type: ApPool, value: number) => Promise<void>;
};

function apTracker(): APTrackerStatic | undefined {
  const fallout = (globalThis as {
    fallout?: { APTrackerV2?: APTrackerStatic; APTracker?: APTrackerStatic };
  }).fallout;
  return fallout?.APTrackerV2 ?? fallout?.APTracker;
}

/** Party AP lives in Fallout world settings (same source as `.ap-resource.party` input). */
export function isPartyApAvailable(): boolean {
  return game.system.id === FALLOUT_SYSTEM_ID;
}

export async function getPartyAp(): Promise<number | null> {
  if (!isPartyApAvailable()) return null;
  try {
    const value = game.settings.get(FALLOUT_SYSTEM_ID, "partyAP");
    return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
  } catch {
    return null;
  }
}

export async function getPartyApMax(): Promise<number | null> {
  if (!isPartyApAvailable()) return null;
  try {
    const value = game.settings.get(FALLOUT_SYSTEM_ID, "maxAP");
    return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0;
  } catch {
    return null;
  }
}

export async function setPartyAp(value: number): Promise<boolean> {
  const tracker = apTracker();
  if (tracker?.setAP) {
    try {
      await tracker.setAP("partyAP", value);
      return true;
    } catch {
      return false;
    }
  }
  if (!game.user?.isGM) return false;
  try {
    await game.settings.set(FALLOUT_SYSTEM_ID, "partyAP", Math.max(0, Math.floor(value)));
    return true;
  } catch {
    return false;
  }
}

/** Uses Fallout's adjustAP (updates settings + AP tracker UI; players route via system.fallout socket). */
export async function addPartyAp(amount: number): Promise<boolean> {
  const grant = Math.max(0, Math.floor(amount));
  if (grant <= 0) return true;

  const tracker = apTracker();
  if (tracker?.adjustAP) {
    try {
      await tracker.adjustAP("partyAP", grant);
      return true;
    } catch {
      return false;
    }
  }

  if (!game.user?.isGM) return false;
  const current = await getPartyAp();
  if (current === null) return false;
  return setPartyAp(current + grant);
}

export async function spendPartyAp(amount = 1): Promise<boolean> {
  const current = await getPartyAp();
  if (current === null) return false;
  if (current < amount) return false;

  const tracker = apTracker();
  if (tracker?.adjustAP) {
    try {
      await tracker.adjustAP("partyAP", -amount);
      return true;
    } catch {
      return false;
    }
  }

  if (!game.user?.isGM) return false;
  return setPartyAp(current - amount);
}
