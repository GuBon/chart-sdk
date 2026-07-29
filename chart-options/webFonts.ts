import {
  NOTO_SANS_KR_FONT_FAMILY,
  PRETENDARD_FONT_FAMILY,
} from './display';
import { CHART_STATIC_ASSET_VERSION } from './assets';

export const CHART_FONT_STYLESHEET_PATH =
  `fonts/${CHART_STATIC_ASSET_VERSION}/chartsdk-fonts.css`;

const FONT_LOAD_TIMEOUT_MS = 5_000;
const MAX_FONT_SAMPLE_CHARACTERS = 8_192;
const stylesheetLoads = new WeakMap<Document, Map<string, Promise<void>>>();

function withTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

export function chartFontStylesheetUrl(assetBase: string): string {
  const base = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  return new URL(CHART_FONT_STYLESHEET_PATH, base).href;
}

function existingStylesheet(doc: Document, href: string): HTMLLinkElement | null {
  return Array.from(doc.querySelectorAll<HTMLLinkElement>('link[data-chartsdk-fonts]'))
    .find((link) => link.href === href) ?? null;
}

function ensureFontStylesheet(doc: Document, href: string): Promise<void> {
  let loads = stylesheetLoads.get(doc);
  if (!loads) {
    loads = new Map();
    stylesheetLoads.set(doc, loads);
  }
  const pending = loads.get(href);
  if (pending) return pending;

  const existing = existingStylesheet(doc, href);
  if (existing?.dataset.chartsdkFonts === 'ready' || existing?.sheet) {
    const ready = Promise.resolve();
    loads.set(href, ready);
    return ready;
  }

  const link = existing ?? doc.createElement('link');
  if (!existing) {
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.chartsdkFonts = 'loading';
  }

  const loaded = new Promise<void>((resolve) => {
    const finish = () => {
      link.dataset.chartsdkFonts = 'ready';
      resolve();
    };
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
  });
  if (!existing) doc.head.append(link);
  const ready = withTimeout(loaded, FONT_LOAD_TIMEOUT_MS);
  loads.set(href, ready);
  return ready;
}

interface FontUsage {
  pretendard: boolean;
  notoSansKr: boolean;
  sample: string;
}

function inspectFontUsage(option: Record<string, unknown>): FontUsage {
  let pretendard = false;
  let notoSansKr = false;
  const characters = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.includes(PRETENDARD_FONT_FAMILY)) pretendard = true;
      if (value.includes(NOTO_SANS_KR_FONT_FAMILY)) notoSansKr = true;
      if (characters.size >= MAX_FONT_SAMPLE_CHARACTERS) return;
      for (const character of value) {
        characters.add(character);
        if (characters.size >= MAX_FONT_SAMPLE_CHARACTERS) break;
      }
      return;
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value as Record<string, unknown>)) visit(item);
  };

  visit(option);
  return {
    pretendard,
    notoSansKr,
    sample: Array.from(characters).join('') || 'ChartSDK 차트',
  };
}

/**
 * 선택한 웹폰트의 CSS와 현재 차트 문자열에 필요한 글리프를 먼저 준비한다.
 * Canvas는 폰트가 늦게 도착해도 자동 재배치되지 않으므로 ECharts setOption 전에 호출해야 한다.
 */
export async function ensureChartWebFonts(
  option: Record<string, unknown>,
  assetBase: string,
  doc: Document = document,
): Promise<void> {
  const usage = inspectFontUsage(option);
  if (!usage.pretendard && !usage.notoSansKr) return;

  await ensureFontStylesheet(doc, chartFontStylesheetUrl(assetBase));
  if (!doc.fonts?.load) return;

  const loads: Promise<unknown>[] = [];
  if (usage.pretendard) {
    loads.push(doc.fonts.load(`12px "${PRETENDARD_FONT_FAMILY}"`, usage.sample));
  }
  if (usage.notoSansKr) {
    loads.push(doc.fonts.load(`12px "${NOTO_SANS_KR_FONT_FAMILY}"`, usage.sample));
  }
  await withTimeout(Promise.allSettled(loads), FONT_LOAD_TIMEOUT_MS);
}
