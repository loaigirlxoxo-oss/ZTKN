# Network Live Graph Implementation

Use these files for actual AIDA64 live network graphs.

## What actually moves

AIDA64 native Graph items move. Static PNG line graph assets do not.

## Files

- `single-graph-presets.csv`
  24 single-line graph presets: design reference + AIDA64 Graph color/settings.

- `dual-graph-presets.csv`
  42 dual graph presets: design reference + two overlaid AIDA64 Graph colors/settings.

- `graph-presets.json`
  Same data in JSON.

- `native-graph-frame-500x112.png`
  Optional static frame/grid overlay.

## Rule

For every line graph visual version, recreate the live behavior with AIDA64 native Graph items using the preset CSV/JSON. The PNG in `network/line-graph-assets` is a visual reference/overlay only.
