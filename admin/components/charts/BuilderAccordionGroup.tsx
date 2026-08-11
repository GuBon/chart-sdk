'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  id: string;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  contentClassName?: string;
  children: ReactNode;
}

/** 차트 구성 탭의 독립적인 접이식 작업 그룹. */
export function BuilderAccordionGroup({
  id,
  title,
  summary,
  defaultOpen = true,
  contentClassName,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${id}-content`;

  return (
    <section className="border-b border-border" data-testid={`${id}-group`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        data-testid={`${id}-toggle`}
        onClick={() => setOpen((current) => !current)}
        className="flex h-11 w-full items-center gap-2 px-4 text-left hover:bg-muted/40"
      >
        {open
          ? <ChevronDown className="size-3.5 shrink-0 text-text-secondary" />
          : <ChevronRight className="size-3.5 shrink-0 text-text-secondary" />}
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        {summary && (
          <span className="ml-auto min-w-0 truncate text-xs text-text-tertiary" title={summary}>
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div id={contentId} data-testid={`${id}-content`} className={contentClassName}>
          {children}
        </div>
      )}
    </section>
  );
}
