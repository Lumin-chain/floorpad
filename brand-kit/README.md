# Floorpad brand kit

Every file here is standalone and ready to upload. The full guide (logo rules, colour, type,
the floor motif, mascot, voice) lives on the site at **/brand**, which also serves each asset
as a download.

## Social (`social/`)

| File | Size | Use |
|---|---|---|
| `floorpad-x-header.png` | 1500 × 500 | X profile header. Content sits clear of the avatar overlap (bottom-left). |
| `floorpad-avatar-mascot.png` | 400 × 400 | Default profile picture (X, Telegram, Discord). Circle-safe. |
| `floorpad-avatar-logo.png` | 400 × 400 | Alternative profile picture with the mark. Circle-safe. |
| `floorpad-link-card.png` | 1200 × 630 | Link preview, same as the site's share card. |
| `floorpad-square-post.png` | 1080 × 1080 | Feed posts and announcements. |
| `floorpad-story.png` | 1080 × 1920 | Stories and status posts. |
| `floorpad-community-banner.png` | 960 × 540 | Discord server banner, Telegram channel header. |
| `floorpad-explainer.png` | 1200 × 1200 | "How the floor rises" card for threads and pinned posts. |

## Logo (`logo/`, transparent PNG)

- `lockup-primary`: mint mark, cream "Floor", mint "pad". On Floor Green / Deep Green only.
- `lockup-cream`: one colour, for photos and busy or dark backgrounds.
- `lockup-green`: one colour, for cream and light backgrounds.
- `symbol-mint` / `symbol-cream` / `symbol-green`: the mark alone.

Clear space: the height of the mark's top slab on every side. Minimum width: 120px for the
lockup, 24px for the mark. Never stretch, rotate, outline, glow or redraw it.

## Mascot (`mascot/`)

Graded, transparent PNGs: `cool` (default), `hero` (wins), `wink` (success), `flag` (launches),
plus `floorpad-mascot-sheet.png`. The brick always stands on a floor; never recolour it,
stretch it or crop off its feet.

## Colour (`floorpad-palette.png`)

| Name | Hex | Role |
|---|---|---|
| Floor Green | `#0F3B2C` | background |
| Deep Green | `#0A2B20` | header, wells |
| Panel | `#134634` | cards, slabs |
| Cream | `#EAD0AC` | all text |
| Logo Mint | `#68F09E` | logo and mascot only |
| Copper | `#B87333` | borders, floor planks |
| Copper Bright | `#D98C53` | calls to action, "floor" in headlines |
| Gold | `#E6C14A` | highlights, level marker |
| Up | `#7DD3A8` | gains, buys |
| Down | `#F0907A` | losses, sells |

## Type

Display: Courier New Bold (site) / JetBrains Mono ExtraBold (images). Body and numbers:
JetBrains Mono. Scale 12 / 14 / 16 / 20 / 24 / 32px.

## Numbers

The graphics carry no fee figures on purpose: taxes are set per token and can change by DAO
vote. Take current figures from the site's Docs page. Never say "guaranteed", "risk-free" or
"the floor only goes up"; the floor is denominated in NEAR/LiNEAR and its USD value moves.

## Regenerating

From `web/`: `node scripts/brand-logos.mjs` (logo variants), `node scripts/grade-mascots.mjs`
(mascot art), then download the social files from `/brand/assets/<name>?download`
(definitions in `web/src/lib/brand-kit.tsx`).
