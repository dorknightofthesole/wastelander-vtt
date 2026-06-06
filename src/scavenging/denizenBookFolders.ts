/** Core rulebook “Denizens of the Wasteland” actor sidebar folders. */
export const DENIZENS_ROOT_FOLDER = "Denizens of the Wasteland";

export type {
  DenizenBookFolder,
  InhabitantType,
} from "./denizenCatalogParse.js";

export {
  DENIZEN_BOOK_SUBFOLDERS,
  LEGACY_INHABITANT_TYPE_MAP,
  isDenizenBookFolder,
  resolveDenizenBookFolder,
} from "./denizenCatalogParse.js";
