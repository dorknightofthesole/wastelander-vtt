import robotSheetTemplate from "../data/robot-sheet-template.json";

interface RobotBodyPart {
  injuries: number[];
  injuryOpenCount: number;
  injuryTreatedCount: number;
  resistance: Record<string, number>;
  status: string;
}

export interface RobotSheetTemplate {
  type: "robot";
  img: string;
  prototypeToken: Record<string, unknown>;
  system: {
    body_parts: Record<string, RobotBodyPart>;
    bodyType: string;
  };
}

const TEMPLATE = robotSheetTemplate as RobotSheetTemplate;

/**
 * Actor document fields applied when converting a character sheet to robot (Mister Handy).
 * Sourced from a Fallout robot actor export; preserves limbs/arms body part structure.
 */
export function getRobotSheetTypeUpdate(): Record<string, unknown> {
  return {
    type: TEMPLATE.type,
    img: TEMPLATE.img,
    prototypeToken: foundry.utils.deepClone(TEMPLATE.prototypeToken),
    "system.body_parts": foundry.utils.deepClone(TEMPLATE.system.body_parts),
    "system.bodyType": TEMPLATE.system.bodyType,
  };
}
