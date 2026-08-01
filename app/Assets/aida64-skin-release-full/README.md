# AIDA64 Skin Release Full

Panel size: 1920 x 480

This is the full release package. Use this when you want all usable alternatives, not only the minimal picked set.

## Backgrounds

- `backgrounds/primary/background-primary-1920x480.png`
  Main implementation background. No baked gauges or sensor values.

- `backgrounds/alternatives/`
  Background-only alternatives.

- `backgrounds/reference/ref-v19-static-mock.png`
  Static visual mock/reference only. Do not use as the live implementation background.

## Custom Gauges

- `custom-gauges/round/`
  All round Custom Gauge sets. Each folder contains 16 states.

- `custom-gauges/horizontal/`
  All horizontal Custom Gauge sets. Each style/color folder contains 16 states.

## Network

- `network/live/`
  Actual AIDA64 native Graph implementation data and frame.

- `network/line-graph-assets/`
  Single-line and Dual line graph visual assets/references. These PNGs are static unless used only as overlays/reference. Use AIDA64 native Graph for live history.

## Guide

- `guide/layout-guide.png`
- `guide/items.csv`
- `guide/text-items.csv`
- `guide/layout.json`

## Important

- Static PNG files do not follow sensor values.
- Use AIDA64 Custom Gauge with 16-state folders for round and horizontal gauges.
- Use AIDA64 native Graph for live network history.
- The line graph PNG folders are visual assets/reference/overlays, not live traces by themselves.

## Live Implementation Files

- `guide/custom-gauge-inventory.csv` lists every Custom Gauge folder that can actually move in AIDA64.
- `network/live/single-graph-presets.csv` maps every Single graph visual to AIDA64 native Graph settings.
- `network/live/dual-graph-presets.csv` maps every Dual graph visual to two overlaid AIDA64 native Graph settings.

Line graph PNGs are not dynamic. Use the preset CSV/JSON to recreate them as native Graph items.


