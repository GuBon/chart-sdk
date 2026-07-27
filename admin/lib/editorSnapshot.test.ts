import { describe, expect, it } from 'vitest';
import { createEditorSnapshot, editorDefinitionEquals } from './editorSnapshot';

const definition = {
  name: '매출',
  datasourceId: 1,
  builder: {
    table: { datasourceId: 1, schema: 'public', name: 'sales' },
    joins: [],
    xAxis: 'month',
    xAxisBucket: null,
    yAxis: [{ column: 'amount', agg: 'sum' as const }],
    where: [],
    orderBy: null,
  },
  chartType: 'bar' as const,
  options: { legend: { show: true } },
};

describe('editorSnapshot', () => {
  it('clones the complete editor definition and preview', () => {
    const snapshot = createEditorSnapshot(definition, {
      result: null,
      resultKind: null,
      option: { series: [] },
      generatedSql: 'select 1',
    });

    definition.builder.xAxis = 'category';
    expect(snapshot.definition.builder.xAxis).toBe('month');
    expect(snapshot.preview.generatedSql).toBe('select 1');
  });

  it('detects builder and name changes as global changes', () => {
    expect(editorDefinitionEquals(definition, structuredClone(definition))).toBe(true);
    expect(editorDefinitionEquals(definition, { ...structuredClone(definition), name: '변경' })).toBe(false);

    const changedBuilder = structuredClone(definition);
    changedBuilder.builder.xAxis = 'region';
    expect(editorDefinitionEquals(definition, changedBuilder)).toBe(false);
  });
});
