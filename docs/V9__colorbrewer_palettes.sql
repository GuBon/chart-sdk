-- Replace every stored chart color contract with the project-owned ColorBrewer v4 defaults.
-- Explicit and generated overrides are cleared so existing charts also adopt ColorBrewer.
UPDATE mc_chart
SET options = options || jsonb_build_object(
        'palettePreset', CASE
            WHEN chart_type IN ('heatmap', 'map') THEN 'blues'
            ELSE 'dark2'
        END,
        'palette', CASE
            WHEN chart_type IN ('heatmap', 'map') THEN
                '["#F7FBFF","#DEEBF7","#C6DBEF","#9ECAE1","#6BAED6","#4292C6","#2171B5","#08519C","#08306B"]'::jsonb
            ELSE
                '["#1B9E77","#D95F02","#7570B3","#E7298A","#66A61E","#E6AB02","#A6761D","#666666"]'::jsonb
        END,
        'paletteActiveIndex', 0,
        'paletteReversed', false,
        'autoColorMap', '{}'::jsonb,
        'colorMap', '{}'::jsonb,
        'itemColorOverrides', '[]'::jsonb,
        'colorTheme', jsonb_build_object(
            'version', 4,
            'qualitativePreset', 'dark2',
            'sequentialPreset', 'blues',
            'divergingPreset', 'rdbu',
            'valueFamily', 'sequential',
            'valueReversed', false
        )
    ),
    version = version + 1,
    updated_at = now();
