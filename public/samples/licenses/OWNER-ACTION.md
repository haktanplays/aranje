# Owner action: vendor the CC BY 3.0 US legal code

**Status:** open. Blocks the public release gate. Does **not** block the
2M-A code closure (K-50).

Aranje ships pre-rendered samples under CC BY 3.0 US. The app displays the
required attribution and links the licence, and the export surface hands that
attribution to anyone exporting a WAV. What is missing is a **copy of the
licence text inside the repository**.

It is missing for one reason only: `creativecommons.org` is not reachable from
the build environment. Every attempt returns a proxy `CONNECT` refusal:

```
$ curl -L https://creativecommons.org/licenses/by/3.0/us/legalcode.en
curl: (56) CONNECT tunnel failed, response 403
```

A legal text must be **copied from its canonical source or not shipped at
all**. It has therefore not been written from memory, not taken from a
third-party mirror, and not substituted with an SPDX copy presented as if it
came from Creative Commons. `manifest.json` keeps `license.textVendored:
false`, and the app says the licence text is not bundled and links out
instead. That is accurate today.

## What the owner needs to do

1. Download the licence text from the official source, on a machine that can
   reach it:

   ```
   curl -L -o public/samples/licenses/CC-BY-3.0-US.txt \
     https://creativecommons.org/licenses/by/3.0/us/legalcode.en
   ```

   - Expected file path: `public/samples/licenses/CC-BY-3.0-US.txt`
   - Official download URL:
     <https://creativecommons.org/licenses/by/3.0/us/legalcode.en>
   - Canonical licence URL (what the app links, and what stays in the
     manifest): <https://creativecommons.org/licenses/by/3.0/us/>

   There is already an automated path, and it is worth knowing what it does
   **not** cover: `scripts/fetch-samples.mjs` tries
   `https://creativecommons.org/licenses/by/3.0/us/legalcode.txt` — not the
   address confirmed above — writes the file, and flips `textPath` and
   `textVendored` itself. If that address no longer serves the text the script
   silently prints "licence text NOT vendored" and carries on, which is how
   this item stayed open. It also records **no checksum**. So: run the script
   if it works, but verify the file that lands and do step 2 by hand either
   way.

2. Record the file's SHA-256 in `public/samples/manifest.json`, beside the
   other licence fields, so a later reader can confirm the copy was not
   edited:

   ```
   shasum -a 256 public/samples/licenses/CC-BY-3.0-US.txt
   ```

3. Set `license.textVendored` to `true` in `public/samples/manifest.json`, and
   point `license.textPath` at the vendored file.

4. Re-run the export acceptance suite. The export sheet reads
   `textVendored` and stops saying the text is not bundled; nothing else in
   the attribution UI or the attribution `.txt` changes.

## What must not be done instead

- Do not vendor the text from a mirror, a package, or a search result.
- Do not reconstruct or paraphrase the licence.
- Do not present an SPDX copy as the canonical Creative Commons source.
- Do not flip `textVendored` to `true` without the file actually being there.

Until step 3 is done, the honest position is the current one: the licence is
named, linked and attributed, and the full text is not bundled.
