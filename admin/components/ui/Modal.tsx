'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

// Figma 모달(277:374 등): 반투명 오버레이 + 흰 카드(rounded-10, shadow-md).
// 오버레이 클릭·ESC 로 닫힌다. 헤더 divider·footer 는 호스트가 결정한다.
interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  divided?: boolean;
}

export function Modal({ title, onClose, children, footer, width = 520, divided = true }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[90vh] flex-col overflow-hidden rounded-[10px] border border-border bg-bg-panel shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)]"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header
          className={cn('flex items-center gap-2.5 py-4 pl-5 pr-4', divided && 'border-b border-border')}
        >
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary transition-colors hover:text-text-primary"
          >
            <X className="size-[18px]" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">{footer}</footer>}
      </div>
    </div>
  );
}
