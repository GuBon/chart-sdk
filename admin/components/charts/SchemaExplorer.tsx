'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Search, Table2 } from 'lucide-react';
import type { Datasource, SchemaTable } from '@/lib/api';
import { tableKey } from '@/lib/builder';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';

// S2 좌측 스키마 탐색기(258:178) — 표시 전용. 데이터/선택 상태는 ChartEditor 소유.
// 데이터소스→테이블→컬럼의 수직 선택 흐름(Redash 패턴).
interface Props {
  datasources: Datasource[];
  tables: SchemaTable[];
  datasourceId: number | null;
  selectedTable: string | null;
  onChangeDatasource: (id: number) => void;
  onSelectTable: (table: string) => void;
}

export function SchemaExplorer({ datasources, tables, datasourceId, selectedTable, onChangeDatasource, onSelectTable }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = query.toLowerCase().trim();
  const filtered = q
    ? tables.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.schema.toLowerCase().includes(q) ||
          t.columns.some((c) => c.name.toLowerCase().includes(q)),
      )
    : tables;

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const selectTable = (name: string) => {
    onSelectTable(name);
    setExpanded((prev) => new Set(prev).add(name));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <Field label="데이터소스">
          <Select
            id="schema-datasource"
            name="schemaDatasource"
            aria-label="데이터소스"
            value={datasourceId ?? ''}
            onChange={(e) => onChangeDatasource(Number(e.target.value))}
            options={datasources.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="데이터소스 선택"
          />
        </Field>
      </div>

      <div className="px-4 pb-2 pt-4">
        <p className="text-sm font-medium text-text-primary">테이블·컬럼</p>
        <p className="mt-1 text-xs text-text-tertiary">읽기 전용 조회</p>
      </div>

      <div className="px-3 pb-2">
        <Input
          id="schema-search"
          name="schemaSearch"
          icon={<Search className="size-3.5" />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="테이블·컬럼 검색"
          disabled={datasourceId == null}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {datasourceId == null ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">데이터소스를 먼저 선택하세요.</p>
        ) : (
          filtered.map((t) => {
            const key = tableKey(t);
            const open = expanded.has(key);
            const active = selectedTable === key;
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => selectTable(key)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted',
                    active ? 'bg-muted font-medium text-text-primary' : 'text-text-primary',
                  )}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(key);
                    }}
                    className="text-text-secondary"
                  >
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </span>
                  <Table2 className="size-3.5 text-text-secondary" />
                  <span className="truncate">{t.name}</span>
                  {t.schema !== 'public' && (
                    <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-text-tertiary">{t.schema}</span>
                  )}
                </button>
                {open &&
                  t.columns.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 py-1 pl-9 pr-2 text-[13px]">
                      <span className="text-text-primary">{c.name}</span>
                      <span className="text-xs text-text-tertiary">{c.type}</span>
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
