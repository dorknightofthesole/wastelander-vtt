import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { presentScavengerRoll } from "../scavenging/scavengerRollChat.js";
import { rollCombatDice } from "../scavenging/dice.js";
import { executeRollTableDraw } from "../scavenging/rollTableLookup.js";
import {
  findEncounterTableByName,
  findEncounterTableForType,
  findEncounterTypeTable,
} from "./encounterTables.js";
import { ENCOUNTER_TABLE_BY_TYPE } from "./travelRules.js";

export type HexcrawlEncounterOutcome = {
  triggered: boolean;
  cdFaces: number[];
  cdEffects: number;
  encounterType?: string;
  encounterName?: string;
  encounterDescription?: string;
  typeRollTotal?: number;
  detailRollTotal?: number;
  error?: string;
};

function stripHtml(text: string): string {
  const div = document.createElement("div");
  div.innerHTML = text;
  return (div.textContent ?? div.innerText ?? text).trim();
}

function rowDescription(row: { description?: string; name?: string }): string {
  const raw = row.description ?? "";
  if (!raw) return "";
  return stripHtml(raw);
}

type EncounterRollLabels = {
  cdRollLabel: string;
  cdRollDetail: string;
  chatHeader: string;
};

const TRAVEL_ENCOUNTER_LABELS: EncounterRollLabels = {
  cdRollLabel: "WASTELANDER.Hexcrawl.Encounters.CdRollLabel",
  cdRollDetail: "WASTELANDER.Hexcrawl.Encounters.CdRollDetail",
  chatHeader: "WASTELANDER.Hexcrawl.Encounters.ChatHeader",
};

const CAMP_ENCOUNTER_LABELS: EncounterRollLabels = {
  cdRollLabel: "WASTELANDER.Hexcrawl.Encounters.CampCdRollLabel",
  cdRollDetail: "WASTELANDER.Hexcrawl.Encounters.CdRollDetail",
  chatHeader: "WASTELANDER.Hexcrawl.Encounters.CampChatHeader",
};

export async function rollHexcrawlEncounter(): Promise<HexcrawlEncounterOutcome> {
  return rollHexcrawlEncounterInner({
    labels: TRAVEL_ENCOUNTER_LABELS,
    resolveDetailTable: async () => {
      const typeTable = await findEncounterTypeTable();
      if (!typeTable) {
        return {
          error: t("WASTELANDER.Hexcrawl.Encounters.MissingTypeTable"),
        };
      }

      const typeDraw = await executeRollTableDraw(typeTable, { displayChat: false });
      const encounterType = typeDraw.label.trim();
      const detailTable = await findEncounterTableForType(encounterType);
      if (!detailTable) {
        return {
          error: t("WASTELANDER.Hexcrawl.Encounters.MissingDetailTable", {
            type: encounterType,
          }),
          encounterType,
          typeRollTotal: typeDraw.rollTotal ?? undefined,
        };
      }

      return {
        encounterType,
        typeRollTotal: typeDraw.rollTotal ?? undefined,
        detailTable,
      };
    },
  });
}

/** Night encounter while camped — 1CD, then Random Campsite Encounters on effect. */
export async function rollHexcrawlCampEncounter(): Promise<HexcrawlEncounterOutcome> {
  const campsiteTableName = ENCOUNTER_TABLE_BY_TYPE.Campsite;
  return rollHexcrawlEncounterInner({
    labels: CAMP_ENCOUNTER_LABELS,
    resolveDetailTable: async () => {
      const detailTable = await findEncounterTableByName(campsiteTableName);
      if (!detailTable) {
        return {
          error: t("WASTELANDER.Hexcrawl.Encounters.MissingDetailTable", {
            type: "Campsite",
          }),
          encounterType: "Campsite",
        };
      }
      return { encounterType: "Campsite", detailTable };
    },
  });
}

async function rollHexcrawlEncounterInner(params: {
  labels: EncounterRollLabels;
  resolveDetailTable: () => Promise<{
    encounterType?: string;
    typeRollTotal?: number;
    detailTable?: RollTable;
    error?: string;
  }>;
}): Promise<HexcrawlEncounterOutcome> {
  const cd = await rollCombatDice(1, { animate: false });
  const outcome: HexcrawlEncounterOutcome = {
    triggered: cd.effects > 0,
    cdFaces: cd.faces,
    cdEffects: cd.effects,
  };

  if (cd.roll) {
    await presentScavengerRoll({
      roll: cd.roll,
      formula: cd.formula,
      label: t(params.labels.cdRollLabel),
      total: cd.sum,
      detail: t(params.labels.cdRollDetail, {
        effects: cd.effects,
      }),
      animate: true,
    });
  }

  if (!outcome.triggered) {
    await postEncounterChat(outcome, params.labels.chatHeader);
    return outcome;
  }

  const resolved = await params.resolveDetailTable();
  if (resolved.encounterType) outcome.encounterType = resolved.encounterType;
  if (resolved.typeRollTotal !== undefined) {
    outcome.typeRollTotal = resolved.typeRollTotal;
  }
  if (resolved.error) {
    outcome.error = resolved.error;
    await postEncounterChat(outcome, params.labels.chatHeader);
    return outcome;
  }

  const detailTable = resolved.detailTable;
  if (!detailTable) {
    outcome.error = t("WASTELANDER.Hexcrawl.Encounters.MissingDetailTable", {
      type: resolved.encounterType ?? "?",
    });
    await postEncounterChat(outcome, params.labels.chatHeader);
    return outcome;
  }

  const detailDraw = await executeRollTableDraw(detailTable, {
    displayChat: false,
    maxAttempts: 12,
  });
  const row = detailDraw.rows[0];
  outcome.encounterName = row?.name ?? detailDraw.label;
  outcome.encounterDescription = row ? rowDescription(row) : "";
  outcome.detailRollTotal = detailDraw.rollTotal ?? undefined;

  await postEncounterChat(outcome, params.labels.chatHeader);
  return outcome;
}

async function postEncounterChat(
  outcome: HexcrawlEncounterOutcome,
  chatHeaderKey: string,
): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/hexcrawl-encounter.hbs`,
    {
      triggered: outcome.triggered,
      cdFaces: outcome.cdFaces.join(", "),
      cdEffects: outcome.cdEffects,
      encounterType: outcome.encounterType ?? "",
      encounterName: outcome.encounterName ?? "",
      encounterDescription: outcome.encounterDescription ?? "",
      strings: {
        header: t(chatHeaderKey),
        cd: t("WASTELANDER.Hexcrawl.Encounters.ChatCd", {
          faces: outcome.cdFaces.join(", "),
          effects: outcome.cdEffects,
        }),
        type: outcome.encounterType
          ? t("WASTELANDER.Hexcrawl.Encounters.ChatType", {
              type: outcome.encounterType,
            })
          : "",
        name: outcome.encounterName ?? "",
      },
    },
  );

  await ChatMessage.create({
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}
