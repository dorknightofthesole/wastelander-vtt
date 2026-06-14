/** Minimal Foundry globals for unit tests (imported before module graph loads). */
Object.assign(globalThis, {
  foundry: {
    applications: {
      api: {
        ApplicationV2: class ApplicationV2 {},
        HandlebarsApplicationMixin: (Base: unknown) => Base,
      },
    },
  },
  game: {
    actors: { get: () => undefined },
    scenes: { get: () => undefined },
    users: { contents: [] },
    user: { id: "test-user" },
    world: {
      getFlag: () => null,
      setFlag: async () => undefined,
    },
  },
  ui: {
    notifications: {
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
    },
  },
  Hooks: { on: () => undefined },
  canvas: {},
});
