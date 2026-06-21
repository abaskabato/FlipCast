# FLIPCAST

**Flip it open. Tune the world.**

FLIPCAST is a 3D flip phone in your browser that tunes thousands of live radio stations and podcasts from around the world. Flip it open, pick a genre or show, press play. No accounts, no signup, no backend — and it's never empty, because somewhere on Earth a station is always live.

Two **bands** share the phone: live **Radio** and on-demand **Podcasts**. Tap the Radio / Podcasts toggle (or press Tab) to switch. In the Podcasts band, browse top shows by category or search, open a show, then play any episode with a scrubbable progress bar (◄◄ / ►► seek 30s).

## Why a radio (and podcasts)

It's the opposite of a cold-start problem: a radio doesn't need other users to be worth using. The moment you open it there's real, live content playing — talk from Tokyo, lo-fi from Berlin, a jazz station in New Orleans — so it's useful to a single visitor on day one.

## How it works

```
Open the page → 3D flip phone boots → a genre's top stations load
Flip open      → ◄ ► switch genre · ▲ ▼ pick a station · OK plays
```

- Stations come from the **[Radio-Browser](https://www.radio-browser.info/) API** — a free, public, community database of live streams. No key, no backend.
- A curated **fallback list** (SomaFM) is bundled, so the radio still plays if the API is unreachable. The 3D phone always boots regardless.
- The LCD shows the station name (scrolling), country, genre, bitrate, a live equalizer, and on-air status.

## Controls

- **Drag** to spin the phone · **tap** the phone (or **Open / Close**) to flip
- **◄ ►** change genre/category · **▲ ▼** pick station/show/episode · **OK / ▶** play & pause
- **Radio / Podcasts** toggle switches bands (keyboard: **Tab**)
- Podcasts: **OK** opens a show's episodes; **END** goes back; **◄ ►** seek ±30s while playing
- Keyboard: arrow keys + **Enter**/**Space** to play, **Esc** to stop / go back

## Local development

Pure static front-end — no build step, no keys:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

> Note: many radio streams are HTTP-only and get blocked on HTTPS pages (mixed
> content). The app prefers HTTPS streams and falls back gracefully; on
> `localhost` everything plays.

## Stack

| What | How |
|---|---|
| 3D rendering | Three.js (vendored, no CDN) |
| Screen UI | Canvas 2D drawn onto the LCD texture (retro green CRT) |
| Stations | Radio-Browser API + bundled SomaFM fallback |
| Playback | HTML `<audio>` element streaming directly |
| Audio FX | Web Audio API (synthesized flip snap) |
| Install | PWA (`manifest.json`, fullscreen on tap) |

## Project structure

```
index.html        entry — importmap, PWA meta, hero, d-pad controls
js/
  main.js         Three.js scene, render loop, audio element + input wiring
  phone.js        3D clamshell model (hinge fold)
  radio.js        the app — station fetching, tuner UI, playback, navigation
  lcd.js          shared retro-LCD draw helpers
  faces.js        keypad + external-screen painters
  audio.js        synthesized flip sound
  site.js         PWA fullscreen-on-tap
```

## Credit

Station data © the [Radio-Browser](https://www.radio-browser.info/) community
project. Fallback streams courtesy of [SomaFM](https://somafm.com/) —
listener-supported; please consider donating to them.

## License

[MIT](LICENSE) — free to use, modify, and redistribute. Open source, no
strings attached. Contributions welcome.

Bundled [Three.js](https://threejs.org/) is also MIT-licensed.
