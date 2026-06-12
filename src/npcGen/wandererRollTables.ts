import { MODULE_ID } from "../constants.js";
import {
  documentFolderId,
  ensureRollTableFolder,
  findRollTableFolder,
  findWorldRollTableByName,
  formatRollTableFolderPath,
  listWorldRollTableSummaries,
  getRollTableDocument,
  rollTableResultCount,
} from "../integrations/rollTableDocuments.js";
import { t } from "../integrations/i18n.js";
import { getBundledOracleRollTableCount } from "../oracle/oracleRollTableImport.js";
import {
  ORACLE_ROOT_FOLDER,
  ORACLE_SUBFOLDER,
} from "../oracle/oracleRollTableFolders.js";
import { executeRollTableDraw } from "../scavenging/rollTableLookup.js";
import type { NpcGenStepId, NpcGeneratorState } from "./npcGeneratorState.js";
import {
  GENERATE_NPC_REQUIRED_TABLES,
  WANDERER_NPC_TABLE_TITLES,
  type WandererNpcTableKey,
} from "./wandererTableTitles.js";

export type WandererDrawResult = {
  label: string;
  rollTotal?: number;
};

export type WandererTableStatus = "ok" | "missing" | "wrong_folder" | "empty_results";

/** Table can be rolled when the document exists (only `missing` blocks). */
export function isWandererTableUsable(status: WandererTableStatus): boolean {
  return status !== "missing";
}

export type WandererTableDiagnostic = {
  key?: WandererNpcTableKey;
  title: string;
  status: WandererTableStatus;
  reason: string;
  expectedFolder: string;
  wandererFolderExists: boolean;
  actualFolder?: string;
  resultCount?: number;
  table?: RollTable;
};

export type NpcGenTableDiagnosticReport = {
  step: NpcGenStepId;
  expectedFolder: string;
  wandererFolderExists: boolean;
  bundledOracleCount: number;
  tablesInWandererFolder: string[];
  tables: WandererTableDiagnostic[];
  /** Blocks rolling (missing or empty). */
  blocking: WandererTableDiagnostic[];
  /** Usable but not in the expected folder. */
  warnings: WandererTableDiagnostic[];
};

const EXPECTED_FOLDER_LABEL = `${ORACLE_ROOT_FOLDER} → ${ORACLE_SUBFOLDER}`;

export async function getWandererFolderId(): Promise<string | undefined> {
  const rootId = await ensureRollTableFolder(ORACLE_ROOT_FOLDER, null);
  if (!rootId) return undefined;
  return ensureRollTableFolder(ORACLE_SUBFOLDER, rootId);
}

function wandererFolderIdSync(): string | undefined {
  const root = findRollTableFolder(ORACLE_ROOT_FOLDER, null);
  if (!root) return undefined;
  return findRollTableFolder(ORACLE_SUBFOLDER, root.id)?.id;
}

function wandererFolderExists(): boolean {
  return wandererFolderIdSync() != null;
}

function listTablesInWandererFolder(): string[] {
  const folderId = wandererFolderIdSync();
  if (!folderId) return [];
  const names: string[] = [];
  for (const row of listWorldRollTableSummaries()) {
    const doc = getRollTableDocument(row.id);
    if (doc && documentFolderId(doc) === folderId) {
      names.push(doc.name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b));
}

function diagnosticReason(
  status: WandererTableStatus,
  title: string,
  options: {
    expectedFolder: string;
    wandererFolderExists: boolean;
    actualFolder?: string;
    resultCount?: number;
  },
): string {
  switch (status) {
    case "ok":
      return t("WASTELANDER.NpcGen.Diagnostics.TableOk", {
        table: title,
        count: options.resultCount ?? 0,
      });
    case "wrong_folder":
      return t("WASTELANDER.NpcGen.Diagnostics.TableWrongFolder", {
        table: title,
        path: options.actualFolder ?? "?",
        expected: options.expectedFolder,
      });
    case "empty_results":
      return t("WASTELANDER.NpcGen.Diagnostics.TableEmpty", {
        table: title,
        path: options.actualFolder ?? options.expectedFolder,
      });
    case "missing":
    default:
      if (!options.wandererFolderExists) {
        return t("WASTELANDER.NpcGen.Diagnostics.WandererFolderMissing", {
          expected: options.expectedFolder,
        });
      }
      return t("WASTELANDER.NpcGen.Diagnostics.TableNotImported", {
        table: title,
        expected: options.expectedFolder,
      });
  }
}

export function diagnoseWandererTableTitle(title: string): WandererTableDiagnostic {
  const expectedFolder = EXPECTED_FOLDER_LABEL;
  const folderId = wandererFolderIdSync();
  const folderExists = folderId != null;
  const base = {
    title,
    expectedFolder,
    wandererFolderExists: folderExists,
  };

  if (!folderId) {
    const elsewhere = findWorldRollTableByName(title);
    if (elsewhere) {
      const actualFolder = formatRollTableFolderPath(elsewhere);
      return {
        ...base,
        status: "wrong_folder",
        actualFolder,
        resultCount: rollTableResultCount(elsewhere),
        table: elsewhere,
        reason: diagnosticReason("wrong_folder", title, {
          expectedFolder,
          wandererFolderExists: false,
          actualFolder,
        }),
      };
    }
    return {
      ...base,
      status: "missing",
      reason: diagnosticReason("missing", title, {
        expectedFolder,
        wandererFolderExists: false,
      }),
    };
  }

  const inFolder = findWorldRollTableByName(title, folderId, { folderOnly: true });
  if (inFolder) {
    const resultCount = rollTableResultCount(inFolder);
    const status: WandererTableStatus = "ok";
    return {
      ...base,
      status,
      actualFolder: expectedFolder,
      resultCount,
      table: inFolder,
      reason:
        resultCount > 0
          ? diagnosticReason("ok", title, {
              expectedFolder,
              wandererFolderExists: true,
              actualFolder: expectedFolder,
              resultCount,
            })
          : t("WASTELANDER.NpcGen.Diagnostics.TableFound", {
              table: title,
              expected: expectedFolder,
            }),
    };
  }

  const elsewhere = findWorldRollTableByName(title);
  if (elsewhere) {
    const actualFolder = formatRollTableFolderPath(elsewhere);
    return {
      ...base,
      status: "wrong_folder",
      actualFolder,
      resultCount: rollTableResultCount(elsewhere),
      table: elsewhere,
      reason: diagnosticReason("wrong_folder", title, {
        expectedFolder,
        wandererFolderExists: true,
        actualFolder,
      }),
    };
  }

  return {
    ...base,
    status: "missing",
    reason: diagnosticReason("missing", title, {
      expectedFolder,
      wandererFolderExists: true,
    }),
  };
}

export function diagnoseWandererTableKey(
  key: WandererNpcTableKey,
): WandererTableDiagnostic {
  const title = WANDERER_NPC_TABLE_TITLES[key];
  return { key, ...diagnoseWandererTableTitle(title) };
}

export function diagnoseNpcGenTables(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): NpcGenTableDiagnosticReport {
  const tables = wandererTablesForNpcStep(step, state).map((key) =>
    diagnoseWandererTableKey(key),
  );
  const blocking = tables.filter((row) => row.status === "missing");
  const warnings = tables.filter(
    (row) =>
      row.status === "wrong_folder" ||
      row.status === "empty_results" ||
      (row.status === "ok" && (row.resultCount ?? 0) === 0),
  );
  return {
    step,
    expectedFolder: EXPECTED_FOLDER_LABEL,
    wandererFolderExists: wandererFolderExists(),
    bundledOracleCount: getBundledOracleRollTableCount(),
    tablesInWandererFolder: listTablesInWandererFolder(),
    tables,
    blocking,
    warnings,
  };
}

export function logNpcGenTableDiagnostics(
  report: NpcGenTableDiagnosticReport,
): NpcGenTableDiagnosticReport {
  const lines = [
    `${MODULE_ID} | NPC generator roll table check (step: ${report.step})`,
    `Expected folder: ${report.expectedFolder}`,
    `Wanderer folder exists: ${report.wandererFolderExists}`,
    `Bundled oracle tables in module: ${report.bundledOracleCount}`,
    report.tablesInWandererFolder.length
      ? `Tables in Wanderer folder: ${report.tablesInWandererFolder.join(", ")}`
      : "Tables in Wanderer folder: (none)",
    ...report.tables.map((row) => {
      const tag =
        row.status === "ok"
          ? "OK"
          : row.status === "wrong_folder"
            ? "WRONG FOLDER"
            : row.status === "empty_results"
              ? "EMPTY"
              : "MISSING";
      const count =
        row.resultCount != null && row.status === "ok"
          ? ` (${row.resultCount} results)`
          : "";
      return `[${tag}] ${row.title}${count} — ${row.reason}`;
    }),
  ];

  if (report.blocking.length) {
    lines.push(
      "Fix: Settings → Wastelander → Import Wanderer oracle roll tables, then reload Foundry (F5).",
    );
    if (report.bundledOracleCount === 0) {
      lines.push(
        "Bundled count is 0 — run `npm run build:oracle -- generate-npc` and `npm run build`, then reload.",
      );
    }
    console.error(lines.join("\n"));
  } else if (report.warnings.length) {
    console.warn(lines.join("\n"));
  } else {
    console.log(lines.join("\n"));
  }

  return report;
}

export function findWandererTable(title: string): RollTable | undefined {
  return diagnoseWandererTableTitle(title).table;
}

export async function drawWandererTable(
  key: WandererNpcTableKey,
  options?: { displayChat?: boolean },
): Promise<WandererDrawResult> {
  const diagnostic = diagnoseWandererTableKey(key);
  const title = diagnostic.title;
  const table = diagnostic.table;

  if (!isWandererTableUsable(diagnostic.status) || !table) {
    console.error(`${MODULE_ID} | cannot draw Wanderer table`, diagnostic);
    throw new Error(diagnostic.reason);
  }

  if (diagnostic.status === "wrong_folder") {
    console.warn(`${MODULE_ID} | drawing Wanderer table from wrong folder`, diagnostic);
  }

  const displayChat = options?.displayChat ?? true;
  const outcome = await executeRollTableDraw(table, {
    displayChat,
    maxAttempts: 12,
  });

  if (outcome.label.startsWith("(No result on ")) {
    throw new Error(
      t("WASTELANDER.NpcGen.Errors.EmptyDraw", { table: title }),
    );
  }

  return {
    label: outcome.label,
    rollTotal: outcome.rollTotal,
  };
}

export function listMissingGenerateNpcTables(): string[] {
  return listBlockingWandererTableTitles(GENERATE_NPC_REQUIRED_TABLES);
}

/** Tables needed for a single generator step (not the whole pipeline). */
export function wandererTablesForNpcStep(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): WandererNpcTableKey[] {
  switch (step) {
    case "givenName":
      return state.rolls.gender === "feminine"
        ? ["namesFeminine"]
        : ["namesMasculine"];
    case "surname":
      return ["surnames"];
    case "age":
      return ["age"];
    case "demeanor":
      return ["demeanorOdds", "demeanorEvens"];
    case "distinctiveFeature1":
    case "distinctiveFeature2":
      return ["distinctiveFeatures"];
    case "profession":
      return ["profession"];
    case "secret":
      return ["secret"];
    case "truth":
      return ["truth"];
    default:
      return [];
  }
}

function listBlockingWandererTableTitles(
  keys: readonly WandererNpcTableKey[],
): string[] {
  return keys
    .map((key) => diagnoseWandererTableKey(key))
    .filter((row) => !isWandererTableUsable(row.status))
    .map((row) => row.title);
}

export function listMissingTablesForNpcStep(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): string[] {
  return listBlockingWandererTableTitles(wandererTablesForNpcStep(step, state));
}

export function listBlockingTableDiagnosticsForNpcStep(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): WandererTableDiagnostic[] {
  return diagnoseNpcGenTables(step, state).blocking;
}

/** @deprecated Use listBlockingTableDiagnosticsForNpcStep */
export function listMissingTableDiagnosticsForNpcStep(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): WandererTableDiagnostic[] {
  return listBlockingTableDiagnosticsForNpcStep(step, state);
}

export function areNpcStepTablesReady(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): boolean {
  return listMissingTablesForNpcStep(step, state).length === 0;
}

export function notifyNpcStepTableDiagnostics(
  report: NpcGenTableDiagnosticReport,
): void {
  const ui = (globalThis as { ui?: { notifications?: { warn: (m: string) => void; error: (m: string) => void } } })
    .ui;
  if (report.blocking.length) {
    ui?.notifications?.error(
      report.blocking.map((row) => `${row.title}: ${row.reason}`).join(" "),
    );
    return;
  }
  if (report.warnings.length) {
    ui?.notifications?.warn(
      report.warnings.map((row) => row.reason).join(" "),
    );
  }
}

export function assertNpcStepTablesReady(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): boolean {
  const report = diagnoseNpcGenTables(step, state);
  if (!report.blocking.length) return true;
  logNpcGenTableDiagnostics(report);
  notifyNpcStepTableDiagnostics(report);
  return false;
}

export function assertGenerateNpcTablesReady(): boolean {
  const blocking = GENERATE_NPC_REQUIRED_TABLES.map((key) =>
    diagnoseWandererTableKey(key),
  ).filter((row) => !isWandererTableUsable(row.status));
  if (!blocking.length) return true;
  const ui = (globalThis as { ui?: { notifications?: { error: (m: string) => void } } })
    .ui;
  const summary = blocking.map((row) => row.reason).join(" ");
  ui?.notifications?.error(summary);
  console.error(`${MODULE_ID} | missing NPC generator tables`, blocking);
  return false;
}
