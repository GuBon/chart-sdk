import { describe, expect, it } from 'vitest';
import { defaultsFor } from '@chartsdk/chart-options';
import { emptyBuilder } from './builder';
import {
  EDITOR_DRAFT_SCHEMA_VERSION,
  editorDraftChartKey,
  readEditorSessionDraft,
  removeEditorSessionDraft,
  writeEditorSessionDraft,
  type EditorSessionDraft,
} from './editorSessionDraft';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('editor session draft', () => {
  it('차트별 키로 저장·복원·삭제한다', () => {
    const storage = memoryStorage();
    const draft: EditorSessionDraft = {
      schemaVersion: EDITOR_DRAFT_SCHEMA_VERSION,
      chartKey: editorDraftChartKey(12),
      baseVersion: 3,
      savedAt: '2026-08-14T00:00:00.000Z',
      chartTypeChosen: true,
      definition: {
        name: '복구할 차트',
        datasourceId: null,
        builder: emptyBuilder(),
        chartType: 'bar',
        options: defaultsFor('bar'),
      },
    };

    expect(writeEditorSessionDraft(draft, storage)).toBe(true);
    expect(readEditorSessionDraft(draft.chartKey, storage)).toEqual(draft);
    removeEditorSessionDraft(draft.chartKey, storage);
    expect(readEditorSessionDraft(draft.chartKey, storage)).toBeNull();
  });

  it('스키마 버전이나 차트 키가 다르면 적용하지 않는다', () => {
    const storage = memoryStorage();
    storage.setItem('chartsdk:editor-draft:chart:12', JSON.stringify({
      schemaVersion: 999,
      chartKey: 'chart:13',
      savedAt: '2026-08-14T00:00:00.000Z',
      definition: {},
    }));

    expect(readEditorSessionDraft('chart:12', storage)).toBeNull();
  });

  it('필수 메타데이터가 빠진 손상된 초안은 적용하지 않는다', () => {
    const storage = memoryStorage();
    storage.setItem('chartsdk:editor-draft:chart:new', JSON.stringify({
      schemaVersion: EDITOR_DRAFT_SCHEMA_VERSION,
      chartKey: 'chart:new',
      baseVersion: null,
      savedAt: '2026-08-14T00:00:00.000Z',
      definition: {
        name: '손상된 초안',
        datasourceId: null,
        builder: emptyBuilder(),
        chartType: 'bar',
        options: defaultsFor('bar'),
      },
    }));

    expect(readEditorSessionDraft('chart:new', storage)).toBeNull();
  });
});
