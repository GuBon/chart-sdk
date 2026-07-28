import type { MajorType, Options } from '@chartsdk/chart-options';
import type { BuilderConfig, QueryResult } from '@/lib/api';

export type EditorResultKind = 'chart' | 'table' | null;

export interface EditorDefinitionSnapshot {
  name: string;
  datasourceId: number | null;
  builder: BuilderConfig;
  chartType: MajorType;
  options: Options;
}

export interface EditorPreviewSnapshot {
  result: QueryResult | null;
  resultKind: EditorResultKind;
  option: Record<string, unknown> | null;
  generatedSql: string | null;
}

export interface SavedEditorSnapshot {
  definition: EditorDefinitionSnapshot;
  preview: EditorPreviewSnapshot;
}

export function createEditorSnapshot(
  definition: EditorDefinitionSnapshot,
  preview: EditorPreviewSnapshot,
): SavedEditorSnapshot {
  return structuredClone({ definition, preview });
}

export function cloneEditorSnapshot(snapshot: SavedEditorSnapshot): SavedEditorSnapshot {
  return structuredClone(snapshot);
}

export function editorDefinitionEquals(
  left: EditorDefinitionSnapshot,
  right: EditorDefinitionSnapshot,
): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

/**
 * 변환기가 계산한 계열 색상은 편집 옵션에도 저장해 새 계열의 색을 안정화한다.
 * 갱신 경로는 현재 옵션과 저장 스냅샷에 이 함수를 함께 적용해 내부 파생값만으로 dirty가 되지 않게 한다.
 */
export function withResolvedAutoColorMap(
  options: Options,
  autoColorMap: Record<string, string> | null,
): Options {
  if (autoColorMap == null) return options;
  if (stableSerialize(options.autoColorMap ?? {}) === stableSerialize(autoColorMap)) return options;
  return { ...options, autoColorMap: structuredClone(autoColorMap) };
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortForComparison(value));
}

function sortForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForComparison(child)]),
  );
}
