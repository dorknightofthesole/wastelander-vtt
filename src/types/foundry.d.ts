/* Minimal Foundry globals for compile-time checks (full types optional). */
declare const game: {
  system: { id: string };
  user: { id: string; isGM: boolean };
  settings: {
    get: (scope: string, key: string) => unknown;
    set: (scope: string, key: string, value: unknown) => Promise<unknown>;
    register: (
      namespace: string,
      key: string,
      data: Record<string, unknown>,
    ) => void;
  };
  actors: { get(id: string): Actor | undefined };
  tables?: {
    contents?: Array<{ name: string; id: string }>;
    find?: (q: string) => { id: string } | undefined;
  };
  i18n: {
    lang?: string;
    translations: Record<string, Record<string, string>>;
    localize: (key: string) => string;
    format: (key: string, data?: Record<string, unknown>) => string;
  };
};

declare const canvas: {
  scene?: { id: string; tokens?: Map<string, { document: { actorId: string | null; actorLink: boolean } }> } | null;
};

declare const Hooks: {
  once: (hook: string, fn: () => void) => void;
  on: (hook: string, fn: (...args: unknown[]) => void) => void;
};

declare const ui: {
  notifications: {
    warn: (message: string) => void;
    info: (message: string) => void;
    error: (message: string) => void;
  };
};

declare const JournalEntry: {
  create: (data: object) => Promise<{ id: string; name?: string }>;
};

declare const JournalEntryPage: {
  create: (data: object) => Promise<{
    id: string;
    setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>;
  }>;
  get: (id: string) => {
    update: (data: object) => Promise<unknown>;
    setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>;
  };
};

declare class Roll {
  total: number | null;
  terms?: unknown[];
  dice?: DieTerm[];
  constructor(formula: string);
  evaluate(options?: object): Promise<Roll>;
}

type DieTerm = {
  denomination?: string | number;
  faces?: number;
  results?: Array<{ result: number; active?: boolean }>;
};

declare const CONST: {
  CHAT_MESSAGE_STYLES: {
    OTHER: number;
  };
};

declare class ChatMessage {
  static getSpeaker(options: { actor?: Actor }): Record<string, unknown>;
  static applyRollMode(data: Record<string, unknown>, mode: string): void;
  static create(data: Record<string, unknown>): Promise<ChatMessage>;
}

interface FalloutGlobal {
  Roller2D20?: {
    showDiceSoNice: (roll: Roll) => Promise<void>;
  };
  utils?: {
    getMessageStyles?: () => { OTHER: number };
  };
}

declare const Dialog: {
  confirm: (options: {
    title?: string;
    content?: string;
    yes?: () => void;
    no?: () => void;
    defaultYes?: boolean;
  }) => void;
};

declare const ContextMenu: new (
  element: HTMLElement,
  menuItems: Array<{
    name: string;
    icon: string;
    callback: () => void;
  }>,
  options?: { eventName?: string; jQuery?: boolean },
) => unknown;

declare function fromUuid(uuid: string): Promise<unknown>;

declare class Actor {
  id: string;
  name: string;
  type: string;
  isOwner: boolean;
  isToken: boolean;
  token: { document?: { actorLink?: boolean; actorId: string } } | null;
  system: Record<string, unknown>;
  static implementation: {
    updateDocuments(
      updates: object[],
      options?: { render?: boolean },
    ): Promise<Actor[]>;
  };
  items: {
    contents?: Item[];
    find: (fn: (item: Item) => boolean) => Item | undefined;
    some: (fn: (item: Item) => boolean) => boolean;
    map?: (fn: (item: Item) => Item) => Item[];
  };
  sheet?: { render: (force?: boolean) => void };
  update(data: object, options?: { render?: boolean }): Promise<unknown>;
  createEmbeddedDocuments(
    type: string,
    data: object[],
    options?: { render?: boolean },
  ): Promise<unknown[]>;
  updateEmbeddedDocuments(
    type: string,
    data: object[],
    options?: { render?: boolean },
  ): Promise<unknown[]>;
  getFlag(scope: string, key: string): unknown;
  setFlag(
    scope: string,
    key: string,
    value: unknown,
    options?: { render?: boolean },
  ): Promise<unknown>;
}

declare class Item {
  name: string;
  type: string;
  img: string;
  id: string;
  flags: Record<string, unknown>;
  effects: Array<{ toObject(): object }>;
  system: Record<string, unknown>;
  toObject(): object;
  update(data: object, options?: { render?: boolean }): Promise<unknown>;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  static implementation: {
    create(
      data: object,
      context?: { parent?: Actor; render?: boolean; keepId?: boolean },
    ): Promise<Item | undefined>;
  };
}

declare namespace foundry {
  const utils: {
    duplicate<T>(value: T): T;
  };
  namespace applications {
    const instances: Map<string, { close(options?: { animate?: boolean }): Promise<unknown>; remove?(): void }>;
  }
  namespace applications {
    namespace ux {
      const ContextMenu: {
        implementation?: new (
          element: HTMLElement,
          menuItems: Array<{
            name: string;
            icon: string;
            callback: () => void;
          }>,
          options?: { eventName?: string; jQuery?: boolean },
        ) => unknown;
      };
      const TextEditor: {
        implementation: {
          enrichHTML: (
            content: string,
            options?: { async?: boolean },
          ) => Promise<string>;
        };
      };
    }
    namespace api {
      class ApplicationV2 {
        id: string;
        appId: string;
        rendered: boolean;
        element: HTMLElement | HTMLElement[];
        constructor(options?: object);
        render(options?: object): Promise<this>;
        close(options?: { animate?: boolean }): Promise<this>;
        bringToFront?(): void;
        remove?(): void;
        protected _prepareContext(
          options?: object,
        ): Promise<Record<string, unknown>>;
      }
      function HandlebarsApplicationMixin<T extends typeof ApplicationV2>(
        Base: T,
      ): T;
    }
  }
}

type ApplicationConfiguration = object;
type ApplicationRenderOptions = object;

interface JQuery {
  find(selector: string): JQuery;
  length: number;
  prepend(content: string | JQuery): JQuery;
  append(content: string | JQuery): JQuery;
  on(event: string, handler: (event: Event) => void): JQuery;
}

declare function $(html: string): JQuery;
