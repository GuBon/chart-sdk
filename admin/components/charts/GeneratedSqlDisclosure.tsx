import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  sql: string | null;
  open: boolean;
  onToggle: () => void;
}

/** 차트 구성과 결과표 사이에 고정되는 읽기 전용 SQL 접이식 영역. */
export function GeneratedSqlDisclosure({ sql, open, onToggle }: Props) {
  return (
    <section className="shrink-0 border-t border-border bg-bg-panel">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="generated-sql-content"
        className="flex h-9 w-full items-center gap-2 px-4 text-left hover:bg-muted/50"
      >
        {open
          ? <ChevronDown className="size-3.5 text-text-secondary" />
          : <ChevronRight className="size-3.5 text-text-secondary" />}
        <span className="text-[13px] text-text-primary">생성된 SQL 보기</span>
        <span className="text-xs text-text-tertiary">· 읽기 전용</span>
      </button>
      {open && (
        <div id="generated-sql-content" className="max-h-40 overflow-auto border-t border-border px-4 py-3">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-text-primary">
            {sql || '실행하면 생성된 SQL이 표시됩니다.'}
          </pre>
        </div>
      )}
    </section>
  );
}
