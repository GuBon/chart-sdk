export const EDITOR_PANEL_LAYOUT = {
  collapsedRailWidth: 40,
  dividerWidth: 1,
  collapseGestureWidth: 48,
  dataPanel: {
    defaultWidth: 320,
    minWidth: 200,
    maxWidth: 480,
  },
  builder: {
    minExpandedWidth: 480,
  },
  visualWorkspace: {
    defaultWidth: 360,
    minWidth: 280,
  },
  resultsPanel: {
    defaultHeight: 288,
    minHeight: 120,
    maxHeight: 560,
  },
  visualOptionPanel: {
    defaultHeight: 280,
    minHeight: 120,
    maxHeight: 720,
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 520,
  },
} as const;

export const RESULTS_HEADER_FLEXIBLE_ITEM_MIN_WIDTH = 72;

export function normalizeBuilderMinimumWidth(width: number): number {
  return Math.max(
    EDITOR_PANEL_LAYOUT.builder.minExpandedWidth,
    Number.isFinite(width) ? Math.ceil(width) : 0,
  );
}

export function projectedBuilderWidth(builderLeft: number, dividerClientX: number): number {
  return Math.max(0, dividerClientX - builderLeft);
}

export function shouldCollapseBuilder(projectedWidth: number, requiredWidth: number): boolean {
  return projectedWidth < normalizeBuilderMinimumWidth(requiredWidth);
}

interface MaximumVisualWorkspaceWidthInput {
  editorWidth: number;
  dataPanelWidth: number;
  dataPanelCollapsed: boolean;
  builderMinimumWidth: number;
}

export function maximumVisualWorkspaceWidth({
  editorWidth,
  dataPanelWidth,
  dataPanelCollapsed,
  builderMinimumWidth,
}: MaximumVisualWorkspaceWidthInput): number {
  const dataSlotWidth = dataPanelCollapsed
    ? EDITOR_PANEL_LAYOUT.collapsedRailWidth
    : Math.max(0, dataPanelWidth) + EDITOR_PANEL_LAYOUT.dividerWidth;

  return Math.max(
    0,
    editorWidth
      - dataSlotWidth
      - EDITOR_PANEL_LAYOUT.dividerWidth
      - normalizeBuilderMinimumWidth(builderMinimumWidth),
  );
}

interface BuilderExpansionInput extends MaximumVisualWorkspaceWidthInput {
  visualWorkspaceWidth: number;
}

export interface BuilderExpansionLayout {
  dataPanelWidth: number;
  dataPanelCollapsed: boolean;
  visualWorkspaceWidth: number;
}

export function resolveBuilderExpansion(input: BuilderExpansionInput): BuilderExpansionLayout | null {
  const candidates = input.dataPanelCollapsed
    ? [{ dataPanelWidth: input.dataPanelWidth, dataPanelCollapsed: true }]
    : [
        { dataPanelWidth: input.dataPanelWidth, dataPanelCollapsed: false },
        { dataPanelWidth: EDITOR_PANEL_LAYOUT.dataPanel.minWidth, dataPanelCollapsed: false },
        { dataPanelWidth: input.dataPanelWidth, dataPanelCollapsed: true },
      ];

  for (const candidate of candidates) {
    const maximumVisualWidth = maximumVisualWorkspaceWidth({
      ...input,
      ...candidate,
    });
    if (maximumVisualWidth < EDITOR_PANEL_LAYOUT.visualWorkspace.minWidth) continue;

    return {
      ...candidate,
      visualWorkspaceWidth: Math.min(
        Math.max(input.visualWorkspaceWidth, EDITOR_PANEL_LAYOUT.visualWorkspace.minWidth),
        maximumVisualWidth,
      ),
    };
  }

  return null;
}

interface FlexRowMinimumWidthInput {
  itemWidths: readonly number[];
  gap: number;
  paddingStart: number;
  paddingEnd: number;
}

export function flexRowMinimumWidth({
  itemWidths,
  gap,
  paddingStart,
  paddingEnd,
}: FlexRowMinimumWidthInput): number {
  const safeWidths = itemWidths.map((width) => Math.max(0, width));
  const gaps = Math.max(0, safeWidths.length - 1) * Math.max(0, gap);
  return Math.ceil(
    safeWidths.reduce((total, width) => total + width, 0)
      + gaps
      + Math.max(0, paddingStart)
      + Math.max(0, paddingEnd),
  );
}
