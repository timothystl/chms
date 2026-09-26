// ── connect.finance-board-layout.v1 ───────────────────────────────────────────────────────────
// The Chart of Accounts presentation settings the legacy Budget Planner builds its Board view from
// (finBuildBoardTree in src/frontend/js-finance.js): each account's saved board category, the
// category heading renames, the "Donor Income" wrapper title, leaf display names, and the purpose
// tag list with its assignments. These are the two finance_settings stores Chart of Accounts
// edits (readPlanningBoardCategories / readPurposeTags); Finance lays out its Budget builder and
// Chart of Accounts editor from them, applying legacy's name-based default to any account with no
// saved category. Structural only: names and paths, no dollar figure. Writes stay on the existing
// finance-board-categories-write-v1 / finance-purpose-tags-write-v1 contracts.
import { json } from './auth.js';
import { readPlanningBoardCategories, readPurposeTags } from './api-finance.js';

export async function buildFinanceBoardLayoutV1(db, { now = new Date() } = {}) {
  const [boardCategories, purposeTags] = await Promise.all([readPlanningBoardCategories(db), readPurposeTags(db)]);
  return {
    contract: 'connect.finance-board-layout.v1',
    dataClassification: 'structural',
    generatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    boardCategories,
    purposeTags,
  };
}

export async function respondWithFinanceBoardLayoutV1(db) {
  return json(await buildFinanceBoardLayoutV1(db));
}
