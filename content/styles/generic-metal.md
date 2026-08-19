# generic-metal

A set of traits, not an artist. Nothing here names a band, a song or a
recording, and nothing here asks for one to be imitated.

## Tonality

Minor-leaning. The declared core scale carries the bar; a raised seventh or a
flat fifth is a colour, used where it means something rather than everywhere.

## Rhythm

Riff-driven and repetitive by design. The motif is the point: keep it, develop
it, do not replace it with a new idea halfway through the section.

## Tempo

Wide, roughly 90 to 180 BPM. Follow the song's own tempo rather than pulling
towards a favourite.

## Texture

- Weight comes from the low strings and from where the accents land, not from
  playing more notes.
- Avoid a continuous wall of notes. Sustained space is part of the sound.
- Drums: relate the kick to the guitar's important accents. Not every guitar
  onset needs a kick under it, and a snare that answers the riff is worth more
  than one that fills every gap.
- Bass: support the guitar's motion. Do not lock blindly to a note-for-note
  unison; root movement and passing notes are what a bass is for.
- Harmony guitar: tonal thirds and sixths are available. Do not transpose the
  whole line in parallel; move with the part, not alongside it.
- Keep the rests. A riff that never breathes stops sounding heavy.

## Example: a low riff that leaves gaps

Palm-muted repeated root, an accent where the line moves, and a rest before it
turns around. E natural minor, one bar of 4/4 at eighth-note resolution.

```json
{
  "operation": "arrange_track",
  "sectionId": "ornek-bolum",
  "targetTrackId": "ornek-gitar",
  "bars": [
    {
      "barIndex": 0,
      "slots": [
        { "notes": [{ "pitch": "E2", "velocity": 104, "articulation": "palm_mute" }] },
        { "notes": [{ "pitch": "E2", "velocity": 88, "articulation": "palm_mute" }] },
        null,
        { "notes": [{ "pitch": "G2", "velocity": 112, "articulation": "accent" }] },
        "-",
        null,
        { "notes": [{ "pitch": "A2", "velocity": 104 }] },
        { "notes": [{ "pitch": "G2", "velocity": 96 }] }
      ]
    }
  ],
  "explanation": "Kok notada palm mute, hareket eden notada aksan, donusten once sus."
}
```

## Example: drums that answer the riff rather than fill it

Kick under the two accents of the riff above, snare on the backbeat, hats
marking the beat, and one slot left empty so the bar breathes.

```json
{
  "operation": "arrange_track",
  "sectionId": "ornek-bolum",
  "targetTrackId": "ornek-davul",
  "bars": [
    {
      "barIndex": 0,
      "slots": [
        [{ "piece": "kick", "velocity": 108 }, { "piece": "closed_hat" }],
        [{ "piece": "closed_hat", "velocity": 72 }],
        [{ "piece": "snare", "velocity": 104 }, { "piece": "closed_hat" }],
        [{ "piece": "closed_hat", "velocity": 72 }],
        [{ "piece": "kick", "velocity": 108 }, { "piece": "closed_hat" }],
        [],
        [{ "piece": "snare", "velocity": 104 }, { "piece": "closed_hat" }],
        [{ "piece": "closed_hat", "velocity": 72 }]
      ]
    }
  ],
  "explanation": "Kick riffin aksanlarinda, snare backbeat'te, bir slot bos birakildi."
}
```
