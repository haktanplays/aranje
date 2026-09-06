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
