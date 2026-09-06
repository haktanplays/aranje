# What the production app could do, walked (2V-E.1 §2)

Not read off the source: `inventory.mjs` opens a fresh browser context with
empty storage, drives the real route at `/`, and writes down what it found.
"The domain has a command for it" and "a reader can reach it" are different
answers, and this is the second one.

```sh
npx next build && npx next start -p 3120
BASE=http://127.0.0.1:3120 node eval/first-song/inventory.mjs
```

## Before this round (`1e372b0`)

| Capability | Status | What the walk found |
|---|---|---|
| Home / opening screen | **MISSING** | an empty device lands straight in the editor, titled "Metal Demo" |
| Empty storage does not auto-open a demo | **MISSING** | first paint leaves `aranje.project.project-1`, `aranje.projects` |
| First project id is allocated, not assumed | **MISSING** | the demo song is migrated into `project-1` before the reader has made anything |
| Project list | works | behind the song title in the editor header |
| New project | works, not atomically proven | three templates, inside the library sheet |
| Create writes one project record | works | new key `aranje.project.project-2` |
| Editor opens on the created project | works | title "Yeni Şarkı" |
| Düzen / Çoklu / Tab views | works | three view buttons |
| Export | **in the UI, behind an info dialog** | reached from the ⓘ "Ses kaynakları ve lisans" button |
| Visible save status | **MISSING** | no element says whether the last edit was saved |
| Corrupt project / catalog is explained | works | one alert region |

Two of those are the round's whole reason for existing. **There was no Home**:
the app had one screen, so it had to open on *something*, and what it opened on
was the demo song adopted into the reader's own library as `project-1`. And the
product menu — new song, song information, export, project backup — lived
inside a dialog whose subtitle is "sample sources and licence".

## After c1

| Capability | Status | What the walk found |
|---|---|---|
| Home / opening screen | **works and is proven** | "Parçaların" |
| Empty state offers exactly one thing to do | **works and is proven** | 1 primary CTA |
| Empty storage does not auto-open a demo | **works and is proven** | keys after first paint: none |
| First project id is allocated, not assumed | **works and is proven** | nothing is written until the reader taps |
| New project | **works and is proven** | one tap; new keys `aranje.project.project-1`, `aranje.projects` |
| Editor opens on the created project | **works and is proven** | title "Yeni parça" |
| Visible save status | **works and is proven** | state `saved` |
| Project list | **works and is proven** | one card on Home, reached from the editor title |
| Project card shows music, not storage | **works and is proven** | "Yeni parça · E minor · 120 BPM · 4/4 · 1 bölüm · 4 ölçü · 1 track · Bugün" |
| A second project leaves the first alone | **works and is proven** | `project-1`, `project-2` |
| Reload comes back to the same project | **works and is proven** | title "Yeni parça 2" |
| Düzen / Çoklu / Tab views | works | three view buttons |
| Corrupt project / catalog is explained | works | one alert region |
| Export | **still behind the info dialog** | c2's work |

Console errors across the whole walk: **0**.

## Still to do, by name

- **Export** is reachable but is not a product door yet (§21, c2).
- **Track and section management** were not walked in c1 and are c2's subject
  (§10–§15).
- **Arrangement overview and the multi view** are unchanged (§16, §17, c2).

---

# c2: track and section management, walked (§10–§15, §21)

`eval/first-song/manage-walk.mjs`, mobile 412×915, against the running app on
the production route, no eval route and no fixture. Every row was reached by
pressing what a reader presses, and "wrote" means the `current` song inside an
`aranje.project.*` record actually changed.

## The finding the first run made

Every step reached nothing — zero track rows, zero section rows, zero controls.
The reason was not that the features were missing. **A freshly created song
opened on Düzen**, and the arrangement is the one surface that carries neither
the track control nor the section stepper, because it draws every section
already. A reader who had just pressed "Hemen başla" was standing in the only
room in the app with no door to writing music in it.

That is fixed in `src/lib/workspace/opening-view.ts`: a song with nothing
written in it opens on the tab, and the arrangement takes over as soon as
there is something to survey. The rule is about the music, not about the
moment — so it is still right on the second visit to a song still empty.

## After the fix

| Capability | Verdict | Evidence |
| --- | --- | --- |
| Open the track manager | **works and is proven** | 1 row, from the tab's track control |
| Add an instrument | **works and is proven** | 2 rows, one musical write |
| The new track is named for its role | **works and is proven** | "Gitar 2", was "Elektro gitar" |
| Instrument, tuning and capo can be changed | **works and is proven** | 1 tuning, 1 capo control |
| Duplicate a track | **works and is proven** | 3 rows |
| Reorder a track | **works and is proven** | first row `track-1` → `track-1-copy` |
| Delete a track | **works and is proven** | confirmed, 3 → 2 rows |
| The track limit is refused in words | **works and is proven** | "Şarkı en fazla 8 track taşıyabilir." |
| Open the section manager | **works and is proven** | 1 row, from the section stepper |
| Add a section | **works and is proven** | name, bar count and meter on the form |
| Duplicate a section | **works and is proven** | 3 rows |
| Rename a section | **works and is proven** | "Nakarat" |
| Reorder a section | **works and is proven** | first row `section-1` → `section-1-copy` |
| **Resize a section after it exists** | **works and is proven** | new: "Uzunluk", 4 → 6 ölçü |
| Shortening says what it will cost first | **works and is proven** | "Son 4 ölçüdeki müzik silinir." |
| Set a section's own tempo | **works and is proven** | 96 BPM on the row |
| Delete a section | **works and is proven** | confirmed, 3 → 2 rows |
| The last section is not deletable | **works and is proven** | "Son kalan bölüm silinemez." |
| `Dışa aktar` reachable by its own name | **works** | behind a door now called "Şarkı menüsü" |

Console errors across the whole walk: **0**.

## What c2 changed, and why

- **§8** A song with nothing in it opens on the tab. Found by walking.
- **§11** A track a reader adds is "Gitar 2", not a second row also reading
  "Elektro gitar". `trackRoleName` names the role; `numberedName` continues
  the series the template started, which `dedupeName` could not.
- **§15** `set_section_bar_count` — a section's length after it exists. New
  bars take the shape of the section's last bar and carry silence; shrinking
  says how many bars of music it will drop before it does it.
- **§15** `songLimits.totalBars` 32 → 64.
- **§21** The header's ⓘ was labelled "Ses kaynakları ve lisans", which named
  the last thing behind it and hid the first. Nobody looking for "Dışa aktar"
  opens a sheet about sound sources. It is "Şarkı menüsü" now.

## Named and not done

- **`barsPerSection` stayed at 8.** Raising it to 64 with the song is a
  measured contradiction, not a caution: the Copilot prompt's worst case is
  one densely written section, and at 64 bars it measures **8412 tokens**
  against a ceiling pinned at 8000 since K-32. Eight bars a section and
  sixty-four in a song is eight sections of eight. Whether to buy a longer
  section by re-measuring or narrowing the prompt is the founder's call.
- **§16 arrangement overview, §17 the multi view, §18 navigation races,
  §19 safe return and reload, §20 project rename and duplicate** were not
  walked in c2 and are not claimed.
