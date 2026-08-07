/**
 * ColorBrewer 2.0 palette specifications.
 *
 * Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The Pennsylvania State University.
 * Licensed under the Apache License, Version 2.0.
 * Source: https://github.com/axismaps/colorbrewer/blob/master/colorbrewer_schemes.js
 * Modified by ChartSDK: RGB values were converted to uppercase HEX, identifiers
 * were normalized, and only each scheme's official maximum class set is retained.
 *
 * ChartSDK keeps the largest official class set for each palette. Qualitative
 * palettes contain 8–12 colors, sequential palettes 9, and diverging palettes 11.
 */

export type ColorBrewerFamily = 'qualitative' | 'sequential' | 'diverging';

export interface ColorBrewerScheme {
  label: string;
  family: ColorBrewerFamily;
  maxClasses: number;
  colors: readonly string[];
}

export const COLORBREWER_SCHEMES = {
  accent: {
    label: 'Accent', family: 'qualitative', maxClasses: 8,
    colors: ['#7FC97F', '#BEAED4', '#FDC086', '#FFFF99', '#386CB0', '#F0027F', '#BF5B17', '#666666'],
  },
  dark2: {
    label: 'Dark2', family: 'qualitative', maxClasses: 8,
    colors: ['#1B9E77', '#D95F02', '#7570B3', '#E7298A', '#66A61E', '#E6AB02', '#A6761D', '#666666'],
  },
  paired: {
    label: 'Paired', family: 'qualitative', maxClasses: 12,
    colors: ['#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C', '#FB9A99', '#E31A1C', '#FDBF6F', '#FF7F00', '#CAB2D6', '#6A3D9A', '#FFFF99', '#B15928'],
  },
  pastel1: {
    label: 'Pastel1', family: 'qualitative', maxClasses: 9,
    colors: ['#FBB4AE', '#B3CDE3', '#CCEBC5', '#DECBE4', '#FED9A6', '#FFFFCC', '#E5D8BD', '#FDDAEC', '#F2F2F2'],
  },
  pastel2: {
    label: 'Pastel2', family: 'qualitative', maxClasses: 8,
    colors: ['#B3E2CD', '#FDCDAC', '#CBD5E8', '#F4CAE4', '#E6F5C9', '#FFF2AE', '#F1E2CC', '#CCCCCC'],
  },
  set1: {
    label: 'Set1', family: 'qualitative', maxClasses: 9,
    colors: ['#E41A1C', '#377EB8', '#4DAF4A', '#984EA3', '#FF7F00', '#FFFF33', '#A65628', '#F781BF', '#999999'],
  },
  set2: {
    label: 'Set2', family: 'qualitative', maxClasses: 8,
    colors: ['#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3', '#A6D854', '#FFD92F', '#E5C494', '#B3B3B3'],
  },
  set3: {
    label: 'Set3', family: 'qualitative', maxClasses: 12,
    colors: ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072', '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5', '#D9D9D9', '#BC80BD', '#CCEBC5', '#FFED6F'],
  },

  blues: {
    label: 'Blues', family: 'sequential', maxClasses: 9,
    colors: ['#F7FBFF', '#DEEBF7', '#C6DBEF', '#9ECAE1', '#6BAED6', '#4292C6', '#2171B5', '#08519C', '#08306B'],
  },
  bugn: {
    label: 'BuGn', family: 'sequential', maxClasses: 9,
    colors: ['#F7FCFD', '#E5F5F9', '#CCECE6', '#99D8C9', '#66C2A4', '#41AE76', '#238B45', '#006D2C', '#00441B'],
  },
  bupu: {
    label: 'BuPu', family: 'sequential', maxClasses: 9,
    colors: ['#F7FCFD', '#E0ECF4', '#BFD3E6', '#9EBCDA', '#8C96C6', '#8C6BB1', '#88419D', '#810F7C', '#4D004B'],
  },
  gnbu: {
    label: 'GnBu', family: 'sequential', maxClasses: 9,
    colors: ['#F7FCF0', '#E0F3DB', '#CCEBC5', '#A8DDB5', '#7BCCC4', '#4EB3D3', '#2B8CBE', '#0868AC', '#084081'],
  },
  greens: {
    label: 'Greens', family: 'sequential', maxClasses: 9,
    colors: ['#F7FCF5', '#E5F5E0', '#C7E9C0', '#A1D99B', '#74C476', '#41AB5D', '#238B45', '#006D2C', '#00441B'],
  },
  greys: {
    label: 'Greys', family: 'sequential', maxClasses: 9,
    colors: ['#FFFFFF', '#F0F0F0', '#D9D9D9', '#BDBDBD', '#969696', '#737373', '#525252', '#252525', '#000000'],
  },
  oranges: {
    label: 'Oranges', family: 'sequential', maxClasses: 9,
    colors: ['#FFF5EB', '#FEE6CE', '#FDD0A2', '#FDAE6B', '#FD8D3C', '#F16913', '#D94801', '#A63603', '#7F2704'],
  },
  orrd: {
    label: 'OrRd', family: 'sequential', maxClasses: 9,
    colors: ['#FFF7EC', '#FEE8C8', '#FDD49E', '#FDBB84', '#FC8D59', '#EF6548', '#D7301F', '#B30000', '#7F0000'],
  },
  pubu: {
    label: 'PuBu', family: 'sequential', maxClasses: 9,
    colors: ['#FFF7FB', '#ECE7F2', '#D0D1E6', '#A6BDDB', '#74A9CF', '#3690C0', '#0570B0', '#045A8D', '#023858'],
  },
  pubugn: {
    label: 'PuBuGn', family: 'sequential', maxClasses: 9,
    colors: ['#FFF7FB', '#ECE2F0', '#D0D1E6', '#A6BDDB', '#67A9CF', '#3690C0', '#02818A', '#016C59', '#014636'],
  },
  purd: {
    label: 'PuRd', family: 'sequential', maxClasses: 9,
    colors: ['#F7F4F9', '#E7E1EF', '#D4B9DA', '#C994C7', '#DF65B0', '#E7298A', '#CE1256', '#980043', '#67001F'],
  },
  purples: {
    label: 'Purples', family: 'sequential', maxClasses: 9,
    colors: ['#FCFBFD', '#EFEDF5', '#DADAEB', '#BCBDDC', '#9E9AC8', '#807DBA', '#6A51A3', '#54278F', '#3F007D'],
  },
  rdpu: {
    label: 'RdPu', family: 'sequential', maxClasses: 9,
    colors: ['#FFF7F3', '#FDE0DD', '#FCC5C0', '#FA9FB5', '#F768A1', '#DD3497', '#AE017E', '#7A0177', '#49006A'],
  },
  reds: {
    label: 'Reds', family: 'sequential', maxClasses: 9,
    colors: ['#FFF5F0', '#FEE0D2', '#FCBBA1', '#FC9272', '#FB6A4A', '#EF3B2C', '#CB181D', '#A50F15', '#67000D'],
  },
  ylgn: {
    label: 'YlGn', family: 'sequential', maxClasses: 9,
    colors: ['#FFFFE5', '#F7FCB9', '#D9F0A3', '#ADDD8E', '#78C679', '#41AB5D', '#238443', '#006837', '#004529'],
  },
  ylgnbu: {
    label: 'YlGnBu', family: 'sequential', maxClasses: 9,
    colors: ['#FFFFD9', '#EDF8B1', '#C7E9B4', '#7FCDBB', '#41B6C4', '#1D91C0', '#225EA8', '#253494', '#081D58'],
  },
  ylorbr: {
    label: 'YlOrBr', family: 'sequential', maxClasses: 9,
    colors: ['#FFFFE5', '#FFF7BC', '#FEE391', '#FEC44F', '#FE9929', '#EC7014', '#CC4C02', '#993404', '#662506'],
  },
  ylorrd: {
    label: 'YlOrRd', family: 'sequential', maxClasses: 9,
    colors: ['#FFFFCC', '#FFEDA0', '#FED976', '#FEB24C', '#FD8D3C', '#FC4E2A', '#E31A1C', '#BD0026', '#800026'],
  },

  brbg: {
    label: 'BrBG', family: 'diverging', maxClasses: 11,
    colors: ['#543005', '#8C510A', '#BF812D', '#DFC27D', '#F6E8C3', '#F5F5F5', '#C7EAE5', '#80CDC1', '#35978F', '#01665E', '#003C30'],
  },
  piyg: {
    label: 'PiYG', family: 'diverging', maxClasses: 11,
    colors: ['#8E0152', '#C51B7D', '#DE77AE', '#F1B6DA', '#FDE0EF', '#F7F7F7', '#E6F5D0', '#B8E186', '#7FBC41', '#4D9221', '#276419'],
  },
  prgn: {
    label: 'PRGn', family: 'diverging', maxClasses: 11,
    colors: ['#40004B', '#762A83', '#9970AB', '#C2A5CF', '#E7D4E8', '#F7F7F7', '#D9F0D3', '#A6DBA0', '#5AAE61', '#1B7837', '#00441B'],
  },
  puor: {
    label: 'PuOr', family: 'diverging', maxClasses: 11,
    colors: ['#7F3B08', '#B35806', '#E08214', '#FDB863', '#FEE0B6', '#F7F7F7', '#D8DAEB', '#B2ABD2', '#8073AC', '#542788', '#2D004B'],
  },
  rdbu: {
    label: 'RdBu', family: 'diverging', maxClasses: 11,
    colors: ['#67001F', '#B2182B', '#D6604D', '#F4A582', '#FDDBC7', '#F7F7F7', '#D1E5F0', '#92C5DE', '#4393C3', '#2166AC', '#053061'],
  },
  rdgy: {
    label: 'RdGy', family: 'diverging', maxClasses: 11,
    colors: ['#67001F', '#B2182B', '#D6604D', '#F4A582', '#FDDBC7', '#FFFFFF', '#E0E0E0', '#BABABA', '#878787', '#4D4D4D', '#1A1A1A'],
  },
  rdylbu: {
    label: 'RdYlBu', family: 'diverging', maxClasses: 11,
    colors: ['#A50026', '#D73027', '#F46D43', '#FDAE61', '#FEE090', '#FFFFBF', '#E0F3F8', '#ABD9E9', '#74ADD1', '#4575B4', '#313695'],
  },
  rdylgn: {
    label: 'RdYlGn', family: 'diverging', maxClasses: 11,
    colors: ['#A50026', '#D73027', '#F46D43', '#FDAE61', '#FEE08B', '#FFFFBF', '#D9EF8B', '#A6D96A', '#66BD63', '#1A9850', '#006837'],
  },
  spectral: {
    label: 'Spectral', family: 'diverging', maxClasses: 11,
    colors: ['#9E0142', '#D53E4F', '#F46D43', '#FDAE61', '#FEE08B', '#FFFFBF', '#E6F598', '#ABDDA4', '#66C2A5', '#3288BD', '#5E4FA2'],
  },
} as const satisfies Record<string, ColorBrewerScheme>;

export type ColorBrewerPreset = keyof typeof COLORBREWER_SCHEMES;

export type ColorBrewerPresetForFamily<Family extends ColorBrewerFamily> = {
  [Preset in ColorBrewerPreset]: typeof COLORBREWER_SCHEMES[Preset]['family'] extends Family ? Preset : never;
}[ColorBrewerPreset];

export function isColorBrewerPreset(value: unknown): value is ColorBrewerPreset {
  return typeof value === 'string' && value in COLORBREWER_SCHEMES;
}

export function colorBrewerScheme(value: unknown): (typeof COLORBREWER_SCHEMES)[ColorBrewerPreset] | null {
  return isColorBrewerPreset(value) ? COLORBREWER_SCHEMES[value] : null;
}
