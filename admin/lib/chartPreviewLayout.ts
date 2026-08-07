import type { PreviewFitMode } from '@chartsdk/chart-options/display';

export type PreviewOptionDock = 'left' | 'bottom';

export const OPTION_PANEL_COLLAPSED_SIZE = 40;
export const OPTION_PANEL_DIVIDER_SIZE = 1;
export const MIN_SIDE_DOCK_PREVIEW_WIDTH = 520;
export const OPTION_DOCK_HYSTERESIS = 40;
export const CHART_PREVIEW_PADDING = 24;

interface OptionDockThresholdInput {
  optionPanelWidth: number;
  optionPanelCollapsed: boolean;
}

interface ResolveAutoOptionDockInput extends OptionDockThresholdInput {
  workspaceWidth: number;
  currentDock: PreviewOptionDock;
}

export function optionDockThresholds({
  optionPanelWidth,
  optionPanelCollapsed,
}: OptionDockThresholdInput) {
  const optionSlotWidth = optionPanelCollapsed
    ? OPTION_PANEL_COLLAPSED_SIZE
    : Math.max(0, optionPanelWidth) + OPTION_PANEL_DIVIDER_SIZE;
  const balancedWidth = optionSlotWidth + MIN_SIDE_DOCK_PREVIEW_WIDTH;

  return {
    enterSideAt: balancedWidth + OPTION_DOCK_HYSTERESIS,
    leaveSideAt: balancedWidth - OPTION_DOCK_HYSTERESIS,
  };
}

export function resolveAutoOptionDock({
  workspaceWidth,
  optionPanelWidth,
  optionPanelCollapsed,
  currentDock,
}: ResolveAutoOptionDockInput): PreviewOptionDock {
  const { enterSideAt, leaveSideAt } = optionDockThresholds({
    optionPanelWidth,
    optionPanelCollapsed,
  });

  if (currentDock === 'left') {
    return workspaceWidth <= leaveSideAt ? 'bottom' : 'left';
  }
  return workspaceWidth >= enterSideAt ? 'left' : 'bottom';
}

interface ChartPreviewGeometryInput {
  viewportWidth: number;
  viewportHeight: number;
  designWidth: number;
  designHeight: number;
  fitMode: PreviewFitMode;
  zoom: number;
  padding?: number;
}

export interface ChartPreviewGeometry {
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
  stageWidth: number;
  stageHeight: number;
  left: number;
  top: number;
}

export function calculateChartPreviewGeometry({
  viewportWidth,
  viewportHeight,
  designWidth,
  designHeight,
  fitMode,
  zoom,
  padding = CHART_PREVIEW_PADDING,
}: ChartPreviewGeometryInput): ChartPreviewGeometry {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeDesignWidth = Math.max(1, designWidth);
  const safeDesignHeight = Math.max(1, designHeight);
  const availableWidth = Math.max(1, safeViewportWidth - padding * 2);
  const availableHeight = Math.max(1, safeViewportHeight - padding * 2);

  let scale: number;
  if (fitMode === 'actual') {
    scale = Math.min(2, Math.max(0.1, zoom / 100));
  } else {
    const widthScale = availableWidth / safeDesignWidth;
    scale = fitMode === 'width'
      ? Math.min(1, widthScale)
      : Math.min(1, widthScale, availableHeight / safeDesignHeight);
  }

  const scaledWidth = Math.max(1, Math.round(safeDesignWidth * scale));
  const scaledHeight = Math.max(1, Math.round(safeDesignHeight * scale));
  const stageWidth = Math.max(safeViewportWidth, scaledWidth + padding * 2);
  const stageHeight = Math.max(safeViewportHeight, scaledHeight + padding * 2);

  return {
    scale,
    scaledWidth,
    scaledHeight,
    stageWidth,
    stageHeight,
    left: Math.max(padding, Math.round((stageWidth - scaledWidth) / 2)),
    top: Math.max(padding, Math.round((stageHeight - scaledHeight) / 2)),
  };
}
