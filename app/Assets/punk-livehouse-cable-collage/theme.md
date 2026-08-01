# punk-livehouse-cable-collage

## Theme

Punk livehouse cable collage for an AIDA64 sensor panel.

This direction uses the selected option 1 and option 3 approach: full-surface
livehouse cable energy, torn flyers, abstract punk typography, road-case metal,
patchbay sockets, plug hardware, gaffer tape, staples, xerox grain, and dirty
poster texture.

## Intent

- Do not reserve a blank black center in the background.
- Keep the full 1920x480 surface visually active.
- Use cables, jacks, plugs, and flyer typography as the primary identity.
- Keep all lettering abstract or unreadable.
- Avoid real band names, logos, album art, readable slogans, faces, characters,
  and gauge mockups baked into the background.

## Backgrounds

- `background-option-1-cable-flyer-1920x480.png`
  - Rough cable/flyer direction.
- `background-option-3-patchbay-cable-1920x480.png`
  - Patchbay, jack, and cable hardware direction.

Source images are stored in the same `backgrounds` folder with `-source` names
so later frame and gauge assets can stay anchored to the accepted design.

## Frames

The frame assets use cable coils, patchbay sockets, plugs, torn flyer scraps,
gaffer tape, staples, dirty paper, and scuffed road-case metal. Centers are
transparent so sensors, gauges, or labels can sit behind/inside them.

- 2 circular frames
- 2 rectangular frames
- 2 square frames

## Custom Gauges

The custom gauges are AIDA64-ready state PNGs, not static mockups.

- Circle gauges:
  - `cable-coil`
  - `patchbay-ring`
- Horizontal gauges:
  - `cable-rail`
  - `patchbay-strip`

Each gauge has 16 states from `state-00` to `state-15`. High values move toward
orange/red. Horizontal gauges use an opaque dark bed under the moving bar so the
bar remains readable on the busy background.
