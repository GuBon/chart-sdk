import { describe, expect, it } from 'vitest';
import {
  calculateChartPreviewGeometry,
  optionDockThresholds,
  resolveAutoOptionDock,
} from './chartPreviewLayout';

describe('차트 미리보기 반응형 레이아웃', () => {
  it('옵션 패널과 최소 미리보기 폭을 합산하고 40px 히스테리시스를 둔다', () => {
    expect(optionDockThresholds({
      optionPanelWidth: 400,
      optionPanelCollapsed: false,
    })).toEqual({
      enterRightAt: 961,
      leaveRightAt: 881,
    });

    expect(optionDockThresholds({
      optionPanelWidth: 400,
      optionPanelCollapsed: true,
    })).toEqual({
      enterRightAt: 600,
      leaveRightAt: 520,
    });
  });

  it('경계 구간에서는 현재 도킹을 유지해 빠른 왕복 전환을 막는다', () => {
    const base = { optionPanelWidth: 400, optionPanelCollapsed: false };

    expect(resolveAutoOptionDock({ ...base, workspaceWidth: 960, currentDock: 'bottom' })).toBe('bottom');
    expect(resolveAutoOptionDock({ ...base, workspaceWidth: 961, currentDock: 'bottom' })).toBe('right');
    expect(resolveAutoOptionDock({ ...base, workspaceWidth: 882, currentDock: 'right' })).toBe('right');
    expect(resolveAutoOptionDock({ ...base, workspaceWidth: 881, currentDock: 'right' })).toBe('bottom');
  });

  it('실제 미리보기 영역으로 가로·세로 화면 맞춤 배율을 계산한다', () => {
    const landscape = calculateChartPreviewGeometry({
      viewportWidth: 758,
      viewportHeight: 466,
      designWidth: 640,
      designHeight: 360,
      fitMode: 'contain',
      zoom: 100,
    });
    expect(landscape.scale).toBe(1);
    expect(landscape.left).toBe(59);
    expect(landscape.top).toBe(53);

    const portrait = calculateChartPreviewGeometry({
      viewportWidth: 758,
      viewportHeight: 466,
      designWidth: 360,
      designHeight: 640,
      fitMode: 'contain',
      zoom: 100,
    });
    expect(portrait.scale).toBeCloseTo(418 / 640, 8);
    expect(portrait.scaledHeight).toBe(418);
    expect(portrait.stageHeight).toBe(466);
  });

  it('너비 맞춤은 확대하지 않고 실제 크기 확대율은 허용 범위로 제한한다', () => {
    expect(calculateChartPreviewGeometry({
      viewportWidth: 1200,
      viewportHeight: 300,
      designWidth: 640,
      designHeight: 360,
      fitMode: 'width',
      zoom: 100,
    }).scale).toBe(1);

    expect(calculateChartPreviewGeometry({
      viewportWidth: 300,
      viewportHeight: 300,
      designWidth: 640,
      designHeight: 360,
      fitMode: 'actual',
      zoom: 500,
    }).scale).toBe(2);
  });
});
