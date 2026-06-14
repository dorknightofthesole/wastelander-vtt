type FalloutMacrosApi = {
  partySleep?: () => Promise<unknown>;
};

type FalloutPartySleepApp = {
  render: (show: boolean) => Promise<unknown>;
};

type FalloutAppsApi = {
  FalloutPartySleep?: new () => FalloutPartySleepApp;
};

type FalloutGlobal = {
  macros?: FalloutMacrosApi;
  apps?: FalloutAppsApi;
};

function falloutGlobal(): FalloutGlobal | undefined {
  return (globalThis as { fallout?: FalloutGlobal }).fallout;
}

/** Open the Fallout system's Party Sleep dialog (GM macro equivalent). */
export async function invokeFalloutPartySleep(): Promise<boolean> {
  if (game.system.id !== "fallout") return false;

  const fallout = falloutGlobal();
  if (!fallout) return false;

  if (typeof fallout.macros?.partySleep === "function") {
    await fallout.macros.partySleep();
    return true;
  }

  const PartySleep = fallout.apps?.FalloutPartySleep;
  if (PartySleep) {
    await new PartySleep().render(true);
    return true;
  }

  return false;
}
