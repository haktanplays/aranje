# progressive-atmospheric-acoustic

A set of traits, not an artist. Nothing here names a band, a song or a
recording, and nothing here asks for one to be imitated.

## Tonality

Modal and minor-leaning, resolving slowly. Colour tones are welcome as passing
movement; the declared core scale still carries the bar.

## Rhythm

Unhurried. Phrases may cross the bar line. Repetition is a structure, not a
filler: a figure that returns changed is worth more than one that never stops.

## Tempo

Roughly 60 to 130 BPM, and comfortable being at the slower end of it.

## Texture

- Leave room for open strings to ring. Resonance is part of the arrangement.
- Balance arpeggios against sustain; do not make every slot an onset.
- Do not rewrite the motif. Develop what is there.
- Dynamic gaps are intentional. There is no obligation to fill a quiet bar.
- Bass and drums stay under the acoustic part rather than covering it: fewer
  onsets, lighter accents, and silence where the guitar is speaking.
- Keep the rests. Space is the character of this texture.

## Example: an arpeggio that is allowed to ring

Rising figure over two bars, the last note held across the bar line so the
phrase does not restart with the bar. E natural minor, 4/4 at eighth-note
resolution.

```json
{
  "operation": "arrange_track",
  "sectionId": "ornek-bolum",
  "targetTrackId": "ornek-gitar",
  "bars": [
    {
      "barIndex": 0,
      "slots": [
        { "notes": [{ "pitch": "E2", "velocity": 72 }] },
        { "notes": [{ "pitch": "B2", "velocity": 64 }] },
        { "notes": [{ "pitch": "E3", "velocity": 68 }] },
        { "notes": [{ "pitch": "G3", "velocity": 60, "articulation": "sustain" }] },
        "-",
        "-",
        { "notes": [{ "pitch": "B3", "velocity": 64, "articulation": "sustain" }] },
        "-"
      ]
    },
    {
      "barIndex": 1,
      "slots": [
        "-",
        null,
        { "notes": [{ "pitch": "A2", "velocity": 68 }] },
        { "notes": [{ "pitch": "E3", "velocity": 60 }] },
        { "notes": [{ "pitch": "C4", "velocity": 64, "articulation": "sustain" }] },
        "-",
        "-",
        null
      ]
    }
  ],
  "explanation": "Yukselen arpej, son nota bar cizgisini asarak uzuyor, arada sus var."
}
```

## Example: a bass that stays underneath

Two notes in two bars, both held. The bass marks the harmony and leaves the
acoustic part the foreground.

```json
{
  "operation": "arrange_track",
  "sectionId": "ornek-bolum",
  "targetTrackId": "ornek-bas",
  "bars": [
    {
      "barIndex": 0,
      "slots": [
        { "notes": [{ "pitch": "E1", "velocity": 68 }] },
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-"
      ]
    },
    {
      "barIndex": 1,
      "slots": [
        "-",
        "-",
        { "notes": [{ "pitch": "A1", "velocity": 64 }] },
        "-",
        "-",
        "-",
        "-",
        "-"
      ]
    }
  ],
  "explanation": "Iki barda iki nota; bas armoniyi tutar, on plani akustige birakir."
}
```
