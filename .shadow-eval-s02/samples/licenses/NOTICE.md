# Third party audio

Aranje ships pre-rendered instrument samples from the **FluidR3_GM** soundfont.

| | |
|---|---|
| Soundfont | FluidR3_GM.sf2 by Frank Wen |
| Files taken from | <https://github.com/gleitz/midi-js-soundfonts> (`gh-pages`, `FluidR3_GM`, per-note MP3) |
| Licence stated by that source | Creative Commons Attribution 3.0, linked to the United States port |
| SPDX | `CC-BY-3.0-US` |
| Licence text | <https://creativecommons.org/licenses/by/3.0/us/> |

## Required attribution

> Contains samples from the FluidR3_GM soundfont by Frank Wen, pre-rendered by
> gleitz/midi-js-soundfonts, licensed under CC BY 3.0 US.

This line must appear in the shipped application and in the store listing.

## Which FluidR3, and therefore which licence

FluidR3 reaches users through more than one route and the routes do not share a
licence. Debian packages a FluidR3 Mono build documented as MIT. The files in
this repository are **not** that build: they are the pre-rendered set published
by `midi-js-soundfonts`, whose README states CC BY 3.0. The licence recorded
here follows the source the files actually came from, not the most permissive
licence FluidR3 appears under somewhere else.

## Open item

The full legal text is not vendored yet: `creativecommons.org` is not reachable
from the build environment, and a legal text must be copied, never
reconstructed. Fetch `https://creativecommons.org/licenses/by/3.0/us/legalcode`
into `CC-BY-3.0-US.txt` in this directory before any public release, and rerun
`node scripts/fetch-samples.mjs` so the manifest flips `textVendored` to true.

Per-file source URLs, byte sizes and SHA-256 checksums are in
`public/samples/manifest.json`.
