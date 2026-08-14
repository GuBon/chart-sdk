'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EDITOR_PANEL_LAYOUT,
  maximumVisualWorkspaceWidth,
  normalizeBuilderMinimumWidth,
  projectedBuilderWidth,
  resolveBuilderExpansion,
  shouldCollapseBuilder,
} from '@/lib/chartEditorLayout';
import { optionDockThresholds, resolveAutoOptionDock } from '@/lib/chartPreviewLayout';
import { useResizable } from '@/components/ui/Resizable';
import type { OptionDock, OptionDockPreference } from './OptionPanel';

const OPTION_DOCK_MANUAL_MIN_WIDTH = 640;

function useStoredBoolean(key: string, initial: boolean, storageEnabled = true) {
  const [value, setValue] = useState(initial);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!storageEnabled) {
      setValue(initial);
      setRestored(true);
      return;
    }
    const stored = window.localStorage.getItem(key);
    if (stored === 'true' || stored === 'false') setValue(stored === 'true');
    setRestored(true);
  }, [initial, key, storageEnabled]);
  useEffect(() => {
    if (restored && storageEnabled) window.localStorage.setItem(key, String(value));
  }, [key, restored, storageEnabled, value]);
  return [value, setValue] as const;
}

function useStoredOptionDockPreference(key: string, storageEnabled = true) {
  const [value, setValue] = useState<OptionDockPreference>('auto');
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!storageEnabled) {
      setValue('auto');
      setRestored(true);
      return;
    }
    const stored = window.localStorage.getItem(key);
    // 오른쪽 옵션 패널을 사용하던 기존 설정은 새 왼쪽 배치로 자연스럽게 이전한다.
    const normalized = stored === 'right' ? 'left' : stored;
    if (normalized === 'auto' || normalized === 'left' || normalized === 'bottom') setValue(normalized);
    setRestored(true);
  }, [key, storageEnabled]);
  useEffect(() => {
    if (restored && storageEnabled) window.localStorage.setItem(key, value);
  }, [key, restored, storageEnabled, value]);
  return [value, setValue, restored] as const;
}

/**
 * S2 편집기의 3분할 패널 레이아웃(크기·접힘·옵션 도크 위치)을 소유하는 훅.
 *
 * 도메인 상태(builder·options·result·save)와는 결합이 없다 — 이 훅은 도메인 상태를 읽지 않고,
 * 도메인 쪽은 반환된 setLeftCollapsed/setBuilderCollapsed 를 호출하는 단방향으로만 이 축과 만난다.
 * ChartEditor 는 반환값을 같은 이름으로 구조분해해 기존 참조를 그대로 유지한다.
 *
 * @param restorePanelState 기존 차트 진입 시에만 패널 상태를 localStorage 에서 복원한다(신규 차트는 기본값).
 */
export function useChartEditorLayout(restorePanelState: boolean) {
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const builderWorkspaceRef = useRef<HTMLElement>(null);
  const visualWorkspaceRef = useRef<HTMLElement>(null);

  const [leftCollapsed, setLeftCollapsed] = useStoredBoolean('chartsdk.editor.leftCollapsed', false, restorePanelState);
  const [builderCollapsed, setBuilderCollapsed] = useStoredBoolean('chartsdk.editor.builderCollapsed', false, restorePanelState);
  const [optionDockPreference, setOptionDockPreference, optionDockPreferenceRestored] = useStoredOptionDockPreference(
    'chartsdk.editor.optionDock',
    restorePanelState,
  );
  const [autoOptionDock, setAutoOptionDock] = useState<OptionDock>('bottom');
  const [builderMinimumWidth, setBuilderMinimumWidth] = useState<number>(EDITOR_PANEL_LAYOUT.builder.minExpandedWidth);

  // S2 3분할 패널 크기 — 사용자가 경계를 드래그해 조절
  const leftPanel = useResizable(
    EDITOR_PANEL_LAYOUT.dataPanel.defaultWidth,
    EDITOR_PANEL_LAYOUT.dataPanel.minWidth,
    EDITOR_PANEL_LAYOUT.dataPanel.maxWidth,
    'left',
    'chartsdk.editor.leftWidth',
    {
      shouldCollapse: (nextSize) => nextSize <= EDITOR_PANEL_LAYOUT.collapseGestureWidth,
      onCollapse: () => setLeftCollapsed(true),
    },
  );
  const rightPanel = useResizable(
    EDITOR_PANEL_LAYOUT.visualWorkspace.defaultWidth,
    EDITOR_PANEL_LAYOUT.visualWorkspace.minWidth,
    null,
    'right',
    'chartsdk.editor.rightWidth',
    {
      shouldCollapse: (_nextSize, event) => {
        const bounds = builderWorkspaceRef.current?.getBoundingClientRect();
        return bounds != null && shouldCollapseBuilder(
          projectedBuilderWidth(bounds.left, event.clientX),
          builderMinimumWidth,
        );
      },
      onCollapse: () => setBuilderCollapsed(true),
    },
  );
  const resultsPanel = useResizable(
    EDITOR_PANEL_LAYOUT.resultsPanel.defaultHeight,
    EDITOR_PANEL_LAYOUT.resultsPanel.minHeight,
    EDITOR_PANEL_LAYOUT.resultsPanel.maxHeight,
    'up',
    'chartsdk.editor.resultsHeight',
  );
  const optionEditor = useResizable(
    EDITOR_PANEL_LAYOUT.visualOptionPanel.defaultHeight,
    EDITOR_PANEL_LAYOUT.visualOptionPanel.minHeight,
    EDITOR_PANEL_LAYOUT.visualOptionPanel.maxHeight,
    'up',
    'chartsdk.editor.optionHeight',
  );
  const optionEditorWidth = useResizable(
    EDITOR_PANEL_LAYOUT.visualOptionPanel.defaultWidth,
    EDITOR_PANEL_LAYOUT.visualOptionPanel.minWidth,
    EDITOR_PANEL_LAYOUT.visualOptionPanel.maxWidth,
    'left',
    'chartsdk.editor.optionWidth',
  );
  const leftPanelSize = leftPanel.size;
  const setLeftPanelSize = leftPanel.setSize;
  const rightPanelSize = rightPanel.size;
  const setRightPanelSize = rightPanel.setSize;

  useEffect(() => {
    const workspace = visualWorkspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      setAutoOptionDock((current) => resolveAutoOptionDock({
        workspaceWidth: entry.contentRect.width,
        optionPanelWidth: optionEditorWidth.size,
        optionPanelCollapsed: false,
        currentDock: current,
      }));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [optionEditorWidth.size]);

  // 왼쪽 고정을 복원하거나 선택했을 때 미리보기가 찌그러지지 않도록 시각화 작업영역을 먼저 확보한다.
  useEffect(() => {
    if (!optionDockPreferenceRestored || optionDockPreference !== 'left' || builderCollapsed) return;
    const editorWidth = editorBodyRef.current?.clientWidth;
    if (editorWidth == null) return;
    const availableWidth = maximumVisualWorkspaceWidth({
      editorWidth,
      dataPanelWidth: leftPanel.size,
      dataPanelCollapsed: leftCollapsed,
      builderMinimumWidth,
    });
    if (availableWidth >= OPTION_DOCK_MANUAL_MIN_WIDTH) {
      const preferredWidth = optionDockThresholds({
        optionPanelWidth: optionEditorWidth.size,
        optionPanelCollapsed: false,
      }).enterSideAt;
      const targetWidth = Math.min(preferredWidth, availableWidth);
      if (rightPanelSize < targetWidth) setRightPanelSize(targetWidth);
    } else {
      setBuilderCollapsed(true);
    }
  }, [
    builderCollapsed,
    builderMinimumWidth,
    leftCollapsed,
    leftPanel.size,
    optionDockPreference,
    optionDockPreferenceRestored,
    optionEditorWidth.size,
    rightPanelSize,
    setRightPanelSize,
    setBuilderCollapsed,
  ]);

  const actualOptionDock: OptionDock = optionDockPreference === 'auto' ? autoOptionDock : optionDockPreference;

  useEffect(() => {
    if (builderCollapsed) return;
    const workspace = builderWorkspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      if (shouldCollapseBuilder(entry.contentRect.width, builderMinimumWidth)) setBuilderCollapsed(true);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [builderCollapsed, builderMinimumWidth, setBuilderCollapsed]);

  const updateBuilderMinimumWidth = useCallback((width: number) => {
    const normalized = normalizeBuilderMinimumWidth(width);
    if (normalized === builderMinimumWidth) return;

    if (!builderCollapsed && normalized > builderMinimumWidth) {
      const editorWidth = editorBodyRef.current?.clientWidth;
      const layout = editorWidth == null ? null : resolveBuilderExpansion({
        editorWidth,
        dataPanelWidth: leftPanelSize,
        dataPanelCollapsed: leftCollapsed,
        builderMinimumWidth: normalized,
        visualWorkspaceWidth: rightPanelSize,
      });

      if (layout) {
        if (layout.dataPanelWidth !== leftPanelSize) setLeftPanelSize(layout.dataPanelWidth);
        if (layout.dataPanelCollapsed !== leftCollapsed) setLeftCollapsed(layout.dataPanelCollapsed);
        if (layout.visualWorkspaceWidth !== rightPanelSize) setRightPanelSize(layout.visualWorkspaceWidth);
      } else {
        setBuilderCollapsed(true);
      }
    }

    setBuilderMinimumWidth(normalized);
  }, [
    builderCollapsed,
    builderMinimumWidth,
    leftCollapsed,
    leftPanelSize,
    rightPanelSize,
    setLeftPanelSize,
    setRightPanelSize,
    setBuilderCollapsed,
    setLeftCollapsed,
  ]);

  const expandBuilderPanel = () => {
    const editorWidth = editorBodyRef.current?.clientWidth;
    if (editorWidth == null) return;

    const layout = resolveBuilderExpansion({
      editorWidth,
      dataPanelWidth: leftPanel.size,
      dataPanelCollapsed: leftCollapsed,
      builderMinimumWidth,
      visualWorkspaceWidth: rightPanel.size,
    });
    if (!layout) return;

    if (layout.dataPanelWidth !== leftPanel.size) leftPanel.setSize(layout.dataPanelWidth);
    if (layout.dataPanelCollapsed !== leftCollapsed) setLeftCollapsed(layout.dataPanelCollapsed);
    if (layout.visualWorkspaceWidth !== rightPanel.size) rightPanel.setSize(layout.visualWorkspaceWidth);
    setBuilderCollapsed(false);
  };

  return {
    editorBodyRef,
    builderWorkspaceRef,
    visualWorkspaceRef,
    leftPanel,
    rightPanel,
    resultsPanel,
    optionEditor,
    optionEditorWidth,
    leftCollapsed,
    setLeftCollapsed,
    builderCollapsed,
    setBuilderCollapsed,
    optionDockPreference,
    setOptionDockPreference,
    actualOptionDock,
    builderMinimumWidth,
    updateBuilderMinimumWidth,
    expandBuilderPanel,
  };
}
