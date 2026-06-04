import { openCompendiumItemSheet } from "../integrations/fallout.js";

export function itemUuidFromTableRow(row: {
  documentUuid?: string;
  type?: string;
}): string | undefined {
  const uuid = row.documentUuid?.trim();
  return uuid || undefined;
}

/** Start a Foundry item drag (drop onto actor sheets / inventory). */
export async function startLootItemDrag(
  event: DragEvent,
  uuid: string,
): Promise<void> {
  if (!uuid || !event.dataTransfer) return;
  const item = await fromUuid(uuid);
  if (!item || typeof item !== "object") return;

  const doc = item as Item & { toDragData?: () => Record<string, unknown>; uuid?: string };
  const dragData =
    typeof doc.toDragData === "function"
      ? doc.toDragData()
      : { type: "Item", uuid: doc.uuid ?? uuid };

  event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  event.dataTransfer.effectAllowed = "copy";
}

export function openLootItemUuid(uuid: string): void {
  void openCompendiumItemSheet(uuid);
}

/** Click/drag on `[data-item-uuid]` loot rows (event delegation). */
export function handleLootItemPointer(
  event: Event,
  mode: "click" | "dragstart",
): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const el = target.closest<HTMLElement>("[data-item-uuid][data-loot-unlocked]");
  if (!el) return;
  const uuid = el.dataset.itemUuid?.trim();
  if (!uuid || el.dataset.lootUnlocked !== "true") return;

  if (mode === "dragstart") {
    void startLootItemDrag(event as DragEvent, uuid);
    return;
  }

  if (mode === "click") {
    const onButton = target.closest("button[data-action='luckJump']");
    if (onButton) return;
    event.preventDefault();
    openLootItemUuid(uuid);
  }
}
