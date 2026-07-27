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
