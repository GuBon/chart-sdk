import { describe, expect, it } from 'vitest';
import {
  EDITOR_PANEL_LAYOUT,
  flexRowMinimumWidth,
  maximumVisualWorkspaceWidth,
  normalizeBuilderMinimumWidth,
  projectedBuilderWidth,
  resolveBuilderExpansion,
  shouldCollapseBuilder,
} from './chartEditorLayout';

describe('chart editor panel layout', () => {
  it('keeps the builder minimum at the base width or the measured content width', () => {
    expect(normalizeBuilderMinimumWidth(240)).toBe(EDITOR_PANEL_LAYOUT.builder.minExpandedWidth);
    expect(normalizeBuilderMinimumWidth(612.2)).toBe(613);
    expect(normalizeBuilderMinimumWidth(Number.NaN)).toBe(EDITOR_PANEL_LAYOUT.builder.minExpandedWidth);
  });

  it('collapses before the projected builder width crosses its required width', () => {
    expect(projectedBuilderWidth(320, 799)).toBe(479);
    expect(shouldCollapseBuilder(479, 480)).toBe(true);
    expect(shouldCollapseBuilder(480, 480)).toBe(false);
  });

  it('budgets the data panel, both dividers, builder, and visual workspace once', () => {
    expect(maximumVisualWorkspaceWidth({
      editorWidth: 1280,
      dataPanelWidth: 320,
      dataPanelCollapsed: false,
      builderMinimumWidth: 480,
    })).toBe(478);

    expect(maximumVisualWorkspaceWidth({
      editorWidth: 1280,
      dataPanelWidth: 320,
      dataPanelCollapsed: true,
      builderMinimumWidth: 480,
    })).toBe(759);
  });

  it('restores the builder by shrinking the data panel only when the current allocation cannot fit', () => {
    expect(resolveBuilderExpansion({
      editorWidth: 1280,
      dataPanelWidth: 320,
      dataPanelCollapsed: false,
      builderMinimumWidth: 544,
      visualWorkspaceWidth: 478,
    })).toEqual({
      dataPanelWidth: 320,
      dataPanelCollapsed: false,
      visualWorkspaceWidth: 414,
    });

    expect(resolveBuilderExpansion({
      editorWidth: 1280,
      dataPanelWidth: 320,
      dataPanelCollapsed: false,
      builderMinimumWidth: 700,
      visualWorkspaceWidth: 760,
    })).toEqual({
      dataPanelWidth: 200,
      dataPanelCollapsed: false,
      visualWorkspaceWidth: 378,
    });
  });

  it('does not restore an invalid three-panel layout when even collapsed data cannot leave every minimum intact', () => {
    expect(resolveBuilderExpansion({
      editorWidth: 1000,
      dataPanelWidth: 320,
      dataPanelCollapsed: false,
      builderMinimumWidth: 700,
      visualWorkspaceWidth: 440,
    })).toBeNull();
  });

  it('calculates a no-wrap flex row minimum from its protected items', () => {
    expect(flexRowMinimumWidth({
      itemWidths: [172.4, 208.2, 114.1],
      gap: 12,
      paddingStart: 16,
      paddingEnd: 16,
    })).toBe(551);
  });
});
