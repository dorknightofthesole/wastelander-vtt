import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import type {
  ItemCategoryRange,
  LocationCategoryId,
  LocationDegree,
  LocationScale,
  LootCategoryKey,
  PartyActorRow,
  ScavengerLocation,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";
import {
  getDegreeReductionPoints,
  getSearchDifficulty,
  SEARCH_TIME_BY_SCALE,
} from "./locationRules.js";
import {
  generateScavengerLocation,
  getCategoryOptions,
  getOtherSlotCount,
} from "./locationGenerator.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import { saveLocationToJournal } from "./journalPersist.js";
import {
  getRollTableDisplayName,
  getRollTableKeysForLocation,
  getScavengingRollTableStatus,
  openScavengingRollTable,
  resolveRollTableKey,
  type ScavengingRollTableKey,
} from "./rollTableRegistry.js";
import { simulateScavengerSearch } from "./searchSimulator.js";
import { getScavengingSettingBoolean, SCAVENGING_SETTINGS } from "./scavengingSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type FormState = {
  name: string;
  concept: string;
  scale: LocationScale;
  categoryId: LocationCategoryId;
  degree: LocationDegree;
  problems: ScavengerLocationProblems;
};

const DEFAULT_PROBLEMS: ScavengerLocationProblems = {
  obstacle: false,
  hazard: false,
  inhabitants: false,
};

export default class ScavengerLocationApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #open: ScavengerLocationApp | null = null;

  party: PartyActorRow[] = [];
  location: ScavengerLocation | null = null;
  #form: FormState = {
    name: "New scavenger location",
    concept: "",
    scale: "average",
    categoryId: "residential",
    degree: "partly",
    problems: { ...DEFAULT_PROBLEMS },
  };

  constructor(options: ApplicationConfiguration = {}) {
    super(options);
    this.party = getPartyActorsOnScene(getActiveSceneId());
    ScavengerLocationApp.#open = this;
  }

  static override DEFAULT_OPTIONS = {
    id: "wastelander-scavenger-generator",
    uniqueId: true,
    classes: ["wastelander-wizard", "wastelander-scavenger-app"],
    window: {
      title: "WASTELANDER.Scavenging.WindowTitle",
      icon: "fa-solid fa-warehouse",
      resizable: true,
    },
    position: { width: 720, height: 820 },
    actions: {
      refreshParty: ScavengerLocationApp.#onRefreshParty,
      toggleParty: ScavengerLocationApp.#onToggleParty,
      updateField: ScavengerLocationApp.#onUpdateField,
      toggleProblem: ScavengerLocationApp.#onToggleProblem,
      generate: ScavengerLocationApp.#onGenerate,
      simulateSearch: ScavengerLocationApp.#onSimulateSearch,
      saveJournal: ScavengerLocationApp.#onSaveJournal,
      openRollTable: ScavengerLocationApp.#onOpenRollTable,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/scavenging/generator.hbs`,
      scrollable: [".wastelander-scavenger-scroll"],
    },
  };

  get title(): string {
    return t("WASTELANDER.Scavenging.WindowTitle");
  }

  static async renderOpen(): Promise<ScavengerLocationApp> {
    if (ScavengerLocationApp.#open?.rendered) {
      ScavengerLocationApp.#open.bringToFront?.();
      return ScavengerLocationApp.#open;
    }
    const app = new ScavengerLocationApp();
    return app.render({ force: true });
  }

  static async closeOpen(): Promise<void> {
    if (ScavengerLocationApp.#open) {
      await ScavengerLocationApp.#open.close();
      ScavengerLocationApp.#open = null;
    }
  }

  protected override async _onClose(options?: object): Promise<void> {
    if (ScavengerLocationApp.#open === this) {
      ScavengerLocationApp.#open = null;
    }
    return super._onClose(options);
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: object,
  ): Promise<void> {
    await super._onRender(context, options);
    const root = this.#rootElement();
    if (!root) return;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[data-action='updateField']",
    ).forEach((el) => {
      el.addEventListener("change", (event) => {
        ScavengerLocationApp.#onUpdateField(this, event, el);
      });
    });
    root.querySelectorAll<HTMLInputElement>("[data-action='toggleParty']").forEach(
      (el) => {
        el.addEventListener("change", (event) => {
          ScavengerLocationApp.#onToggleParty(this, event, el);
        });
      },
    );
    root.querySelectorAll<HTMLInputElement>("[data-action='toggleProblem']").forEach(
      (el) => {
        el.addEventListener("change", (event) => {
          ScavengerLocationApp.#onToggleProblem(this, event, el);
        });
      },
    );
  }

  #rootElement(): HTMLElement | null {
    const el = this.element;
    if (el instanceof HTMLElement) return el;
    if (Array.isArray(el) && el[0] instanceof HTMLElement) return el[0];
    return null;
  }

  protected override async _prepareContext(
    _options?: object,
  ): Promise<Record<string, unknown>> {
    const scaleOptions = (
      ["tiny", "small", "average", "large"] as LocationScale[]
    ).map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      selected: value === this.#form.scale,
    }));

    const degreeOptions = (
      ["untouched", "partly", "mostly", "heavily"] as LocationDegree[]
    ).map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      selected: value === this.#form.degree,
    }));

    const categoryOptions = getCategoryOptions().map((c) => ({
      ...c,
      selected: c.id === this.#form.categoryId,
    }));

    const scale = this.location?.scale ?? this.#form.scale;
    const degree = this.location?.degree ?? this.#form.degree;
    const categoryId = this.location?.categoryId ?? this.#form.categoryId;
    const searchTime = SEARCH_TIME_BY_SCALE[scale];

    const generated = {
      level:
        this.location != null
          ? String(this.location.level)
          : t("WASTELANDER.Scavenging.Generated.NotYet"),
      searchDifficulty:
        this.location?.searchDifficulty ?? getSearchDifficulty(degree),
      searchMinutes: this.location?.searchMinutes ?? searchTime.minutes,
      searchTimeLabel: searchTime.label,
    };

    const rollTableKeys = this.location
      ? ([
          ...getRollTableKeysForLocation(this.location.items),
          "otherFoundItems",
        ] as ScavengingRollTableKey[])
      : undefined;
    const rollTableStatus = getScavengingRollTableStatus(rollTableKeys);
    const lootGridRows = buildLootGridRows(this.location, rollTableStatus.tables, {
      categoryId,
      scale,
    });

    const reductionPts = getDegreeReductionPoints(degree, scale);
    const scaleLabel = scale.charAt(0).toUpperCase() + scale.slice(1);
    const reduction = {
      formulaLine: t("WASTELANDER.Scavenging.Tables.ReductionFormula", {
        tinyReduced: reductionPts.tinyReduced,
        degree: reductionPts.degreeLabel,
        scaleMult: reductionPts.scaleMultiplier,
        scale: scaleLabel,
        total: reductionPts.total,
      }),
      hint: t("WASTELANDER.Scavenging.Tables.ReductionHint", {
        total: reductionPts.total,
      }),
    };

    const simulateLoot = (this.location?.lootResults ?? []).filter(
      (r) => r.category !== "junk",
    );

    const otherFound = (this.location?.otherFoundRolls ?? []).map((roll) => ({
      d20: roll.d20,
      label: formatLootCategoryLabel(roll.category),
    }));

    return {
      party: this.party,
      partyEmpty: this.party.length === 0,
      name: this.#form.name,
      concept: this.#form.concept,
      scaleOptions,
      categoryOptions,
      degreeOptions,
      problems: this.#form.problems,
      generated,
      location: this.location ? { simulateLoot } : null,
      rollTables: {
        rows: lootGridRows,
        allInstalled: rollTableStatus.allInstalled,
        sidebarHint: t("WASTELANDER.Scavenging.Tables.SidebarHint"),
        showMinMax: Boolean(this.location),
        reduction,
      },
      otherFound,
    };
  }

  static #onRefreshParty(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    this.party = getPartyActorsOnScene(getActiveSceneId());
    void this.render();
  }

  static #onToggleParty(
    this: ScavengerLocationApp,
    event: Event,
    target: HTMLElement,
  ): void {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    const row = this.party.find((p) => p.actorId === actorId);
    if (row) row.selected = (target as HTMLInputElement).checked;
  }

  static #onUpdateField(
    this: ScavengerLocationApp,
    event: Event,
    target: HTMLElement,
  ): void {
    const field = target.dataset.field as keyof FormState | undefined;
    if (!field) return;
    const el = target as HTMLInputElement | HTMLSelectElement;
    if (field === "scale") {
      this.#form.scale = el.value as LocationScale;
      void this.render();
    } else if (field === "categoryId") {
      this.#form.categoryId = el.value as LocationCategoryId;
      void this.render();
    } else if (field === "degree") {
      this.#form.degree = el.value as LocationDegree;
      void this.render();
      void this.render();
    } else if (field === "name") {
      this.#form.name = el.value;
    } else if (field === "concept") {
      this.#form.concept = el.value;
    }
  }

  static #onToggleProblem(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const key = target.dataset.problem as keyof ScavengerLocationProblems | undefined;
    if (!key || !(key in this.#form.problems)) return;
    (this.#form.problems as Record<string, boolean>)[key] = (
      target as HTMLInputElement
    ).checked;
  }

  static async #onGenerate(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): Promise<void> {
    const sceneId = getActiveSceneId();

    try {
      this.location = await generateScavengerLocation({
        name: this.#form.name.trim() || "Scavenger location",
        concept: this.#form.concept.trim() || undefined,
        scale: this.#form.scale,
        categoryId: this.#form.categoryId,
        degree: this.#form.degree,
        party: this.party,
        problems: { ...this.#form.problems },
        levelOverride: null,
        autoAllocateDegree: getScavengingSettingBoolean(
          SCAVENGING_SETTINGS.autoAllocateDegreeReduction,
        ),
        sceneId,
      });

      ui.notifications.info(
        t("WASTELANDER.Scavenging.Notify.Generated", {
          level: this.location.level,
        }),
      );
      void this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications.error(
        t("WASTELANDER.Scavenging.Notify.GenerateError", { error: message }),
      );
    }
  }

  static #onSimulateSearch(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    if (!this.location) return;

    Dialog.confirm({
      title: t("WASTELANDER.Scavenging.Simulate.Title"),
      content: t("WASTELANDER.Scavenging.Simulate.Body"),
      yes: () => {
        if (!this.location) return;
        void simulateScavengerSearch(this.location, true).then((updated) => {
          this.location = updated;
          void this.render();
          ui.notifications.info(t("WASTELANDER.Scavenging.Notify.SearchDone"));
        });
      },
    });
  }

  static async #onSaveJournal(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): Promise<void> {
    if (!this.location) return;
    try {
      this.location = await saveLocationToJournal(this.location);
      ui.notifications.info(t("WASTELANDER.Scavenging.Notify.JournalSaved"));
      void this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications.error(
        t("WASTELANDER.Scavenging.Notify.JournalError", { error: message }),
      );
    }
  }

  static #onOpenRollTable(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const tableId = target.dataset.tableId;
    if (!tableId) return;
    openScavengingRollTable(tableId);
  }
}

function formatLootCategoryLabel(category: LootCategoryKey): string {
  if (category === "junk") return "Junk";
  if (category === "weapons") return "Weapons";
  const key = resolveRollTableKey(category);
  if (key) return getRollTableDisplayName(key);
  return category;
}

type LootGridRow = {
  label: string;
  min: string;
  max: string;
  installed: boolean;
  tableId?: string;
  resultCount?: number;
};

function buildLootGridRows(
  location: ScavengerLocation | null,
  statusRows: ReturnType<typeof getScavengingRollTableStatus>["tables"],
  preview: { categoryId: LocationCategoryId; scale: LocationScale },
): LootGridRow[] {
  const statusByKey = new Map(
    statusRows.map((row) => [row.tableKey, row] as const),
  );
  const otherSlotsPreview = getOtherSlotCount(preview.categoryId, preview.scale);
  const otherStatus = statusByKey.get("otherFoundItems");

  if (!location) {
    return statusRows.map((row) => {
      const isOther = row.tableKey === "otherFoundItems";
      const slotStr = String(otherSlotsPreview);
      return {
        label: row.name,
        min: isOther ? slotStr : "—",
        max: isOther ? slotStr : "—",
        installed: row.installed,
        tableId: row.tableId,
        resultCount: row.resultCount,
      };
    });
  }

  const rows = location.items.map((item) =>
    lootGridRowFromItem(item, statusByKey),
  );
  const otherSlots = location.otherFoundRolls?.length ?? otherSlotsPreview;
  rows.push({
    label: getRollTableDisplayName("otherFoundItems"),
    min: String(otherSlots),
    max: String(otherSlots),
    installed: otherStatus?.installed ?? false,
    tableId: otherStatus?.tableId,
    resultCount: otherStatus?.resultCount,
  });

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function lootGridRowFromItem(
  item: ItemCategoryRange,
  statusByKey: Map<
    string,
    ReturnType<typeof getScavengingRollTableStatus>["tables"][number]
  >,
): LootGridRow {
  const tableKey = resolveRollTableKey(item.category);
  const label = formatLootCategoryLabel(item.category);
  const status = tableKey ? statusByKey.get(tableKey) : undefined;

  return {
    label,
    min: String(item.min),
    max: String(item.max),
    installed: status?.installed ?? false,
    tableId: status?.tableId,
    resultCount: status?.resultCount,
  };
}

function getActiveSceneId(): string | undefined {
  const canvas = (globalThis as { canvas?: { scene?: { id: string } | null } })
    .canvas;
  return canvas?.scene?.id;
}
