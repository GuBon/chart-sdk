import type { EditorDefinitionSnapshot } from './editorSnapshot';

export const EDITOR_DRAFT_SCHEMA_VERSION = 1 as const;
const PREFIX = 'chartsdk:editor-draft:';

export type EditorDraftChartKey = `chart:${number}` | 'chart:new';

export interface EditorSessionDraft {
  schemaVersion: typeof EDITOR_DRAFT_SCHEMA_VERSION;
  chartKey: EditorDraftChartKey;
  baseVersion: number | null;
  savedAt: string;
  definition: EditorDefinitionSnapshot;
  chartTypeChosen: boolean;
}

export function editorDraftChartKey(chartId?: number | null): EditorDraftChartKey {
  return chartId == null ? 'chart:new' : `chart:${chartId}`;
}

export function readEditorSessionDraft(
  chartKey: EditorDraftChartKey,
  storage: Pick<Storage, 'getItem'> = window.sessionStorage,
): EditorSessionDraft | null {
  try {
    const raw = storage.getItem(`${PREFIX}${chartKey}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<EditorSessionDraft>;
    if (value.schemaVersion !== EDITOR_DRAFT_SCHEMA_VERSION || value.chartKey !== chartKey
      || !value.definition || typeof value.savedAt !== 'string'
      || typeof value.chartTypeChosen !== 'boolean') return null;
    return value as EditorSessionDraft;
  } catch {
    return null;
  }
}

export function writeEditorSessionDraft(
  draft: EditorSessionDraft,
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
): boolean {
  try {
    storage.setItem(`${PREFIX}${draft.chartKey}`, JSON.stringify(draft));
    return true;
  } catch {
    // 저장 공간 부족·브라우저 정책 실패는 편집을 막지 않는다.
    return false;
  }
}

export function removeEditorSessionDraft(
  chartKey: EditorDraftChartKey,
  storage: Pick<Storage, 'removeItem'> = window.sessionStorage,
): void {
  try {
    storage.removeItem(`${PREFIX}${chartKey}`);
  } catch {
    // 복구 보조 기능 실패가 본 편집 흐름을 막지 않게 한다.
  }
}
