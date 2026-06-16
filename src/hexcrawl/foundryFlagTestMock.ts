import { MODULE_ID } from "../constants.js";

/** Foundry merges nested flag objects; deleted keys survive unless the flag is unset first. */
export function mergeLikeFoundryFlags(existing: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return structuredClone(incoming);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return structuredClone(incoming);
  }
  const out = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    out[key] = mergeLikeFoundryFlags(out[key], value);
  }
  return out;
}

export type FoundryFlagSceneMock = {
  unsetFlag?: (scope: string, key: string) => Promise<void>;
  setFlag: (scope: string, key: string, value: unknown) => Promise<void>;
  getFlag: (scope: string, key: string) => unknown;
  update?: (data: Record<string, unknown>) => Promise<void>;
};

/** Scene mock with unsetFlag + merge-on-set (matches fixed persistence path). */
export function createFoundryFlagScene(
  flags: Record<string, Record<string, unknown>>,
): FoundryFlagSceneMock {
  return {
    unsetFlag: async (scope: string, key: string) => {
      if (flags[scope]) delete flags[scope][key];
    },
    setFlag: async (scope: string, key: string, value: unknown) => {
      if (!flags[scope]) flags[scope] = {};
      flags[scope][key] = mergeLikeFoundryFlags(flags[scope][key], value);
    },
    getFlag: (scope: string, key: string) => flags[scope]?.[key],
    update: async (data: Record<string, unknown>) => {
      for (const [path, val] of Object.entries(data)) {
        const match = path.match(/^flags\.([^.\[]+)\.([^.\[]+)\.-([^.\[]+)$/);
        if (!match || val !== null) continue;
        const [, scope, flagKey, field] = match;
        const row = flags[scope]?.[flagKey] as Record<string, unknown> | undefined;
        if (row) delete row[field];
      }
    },
  };
}

/** Scene mock without unsetFlag — reproduces the production bug if used for cover removal. */
export function createMergeOnlyFoundryFlagScene(
  flags: Record<string, Record<string, unknown>>,
): FoundryFlagSceneMock {
  return {
    setFlag: async (scope: string, key: string, value: unknown) => {
      if (!flags[scope]) flags[scope] = {};
      flags[scope][key] = mergeLikeFoundryFlags(flags[scope][key], value);
    },
    getFlag: (scope: string, key: string) => flags[scope]?.[key],
  };
}

export function countCoverHexKeys(
  annotations: Record<string, { hexCoverColor?: string }> | undefined,
): number {
  return Object.values(annotations ?? {}).filter((row) => row.hexCoverColor).length;
}

export function installHexcrawlFlagGame(
  sceneId: string,
  scene: FoundryFlagSceneMock,
): void {
  (globalThis as { game?: unknown }).game = {
    scenes: {
      get: (id: string) => (id === sceneId ? scene : undefined),
    },
    world: { getFlag: () => null, unsetFlag: async () => undefined },
    user: { isGM: true },
  };
}

export { MODULE_ID };
