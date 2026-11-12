import type { Metadata } from "next";
import { KIT, LOGO_MINT } from "@/lib/brand-kit";
import { FloorRise } from "@/components/FloorRise";

export const metadata: Metadata = {
  title: "Brand Kit",
  description: "Floorpad brand guide: logo, colour, type, the floor motif, the mascot, voice, and every social asset as a download.",
};

const LOGOS: { file: string; name: string; bg: string; note: string }[] = [
  { file: "lockup-primary", name: "Primary lockup", bg: "#0F3B2C", note: "Default. On Floor Green or Deep Green only." },
  { file: "lockup-cream", name: "One-colour cream", bg: "#0A2B20", note: "On photos, busy or dark backgrounds." },
  { file: "lockup-green", name: "One-colour green", bg: "#EAD0AC", note: "On cream, paper and light backgrounds." },
  { file: "symbol-mint", name: "Mark, mint", bg: "#0F3B2C", note: "Favicons, small spaces, stickers." },
  { file: "symbol-cream", name: "Mark, cream", bg: "#0A2B20", note: "One-colour mark on dark." },
  { file: "symbol-green", name: "Mark, green", bg: "#EAD0AC", note: "One-colour mark on light." },
];

const COLOURS: [string, string, string][] = [
  ["Floor Green", "#0F3B2C", "Page background. The brand's ground."],
  ["Deep Green", "#0A2B20", "Header, footer, inset wells, readouts."],
  ["Panel", "#134634", "Cards and floor slabs."],
  ["Cream", "#EAD0AC", "All text. Never pure white."],
  ["Logo Mint", LOGO_MINT, "The logo and mascot only. Not for UI."],
  ["Copper", "#B87333", "Borders, floor planks, dividers."],
  ["Copper Bright", "#D98C53", "Calls to action, the top floor, 'floor' in headlines."],
  ["Gold", "#E6C14A", "Highlights, floor level marker, testnet badge."],
  ["Up", "#7DD3A8", "Gains, buys, vault values."],
  ["Down", "#F0907A", "Losses, sells, errors."],
];

const POSES: [string, string][] = [
  ["cool", "Default. Avatars, hero, empty states."],
  ["hero", "Wins, milestones, graduations."],
  ["wink", "Success messages and confirmations."],
  ["flag", "Launches and new tokens."],
];

function Download({ href, label = "Download PNG", file }: { href: string; label?: string; file?: string }) {
  return (
    <a className="btn sm" href={href} download={file}>
      {label}
    </a>
  );
}

export default function BrandPage() {
  return (
    <div className="brand-page">
      <section className="brand-hero">
        <div className="stack" style={{ gap: 12 }}>
          <span className="badge">Brand kit · v2</span>
          <h1 className="page-title" style={{ fontSize: "var(--fs-2xl)" }}>
            Every meme gets a <span className="copper">floor</span>.
          </h1>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            One idea runs through everything Floorpad makes: a floor that rises. Fees from every trade lay another layer
            under a redeemable vault, and the brand draws exactly that. Tiled floors, copper planks, slabs stacking up, and
            the brick standing on top. Everything below is free to use for Floorpad content.
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn primary" href="#social">Social assets</a>
            <a className="btn ghost" href="#logo">Logo</a>
            <a className="btn ghost" href="#voice">Voice</a>
          </div>
        </div>
        <div className="desktop-only-block">
          <FloorRise vault="$4.06" />
        </div>
      </section>

      {/* ---------- logo ---------- */}
      <section id="logo" className="section brand-section">
        <h2 className="section-title">Logo</h2>
        <p className="muted small brand-lede">
          The mark is three stacked slabs, the floor building up. &ldquo;Floor&rdquo; sets in cream, &ldquo;pad&rdquo; in mint. Keep clear space around
          the lockup equal to the height of the mark&apos;s top slab, and never set the lockup narrower than 120px (the mark alone: 24px).
        </p>
        <div className="brand-grid three">
          {LOGOS.map((l) => (
            <div key={l.file} className="panel brand-card">
              <div className="brand-swatch" style={{ background: l.bg }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/kit/${l.file}.png`} alt={l.name} style={{ maxWidth: l.file.startsWith("symbol") ? "38%" : "84%" }} />
              </div>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <b>{l.name}</b>
                  <div className="xs muted">{l.note}</div>
                </div>
                <Download href={`/brand/kit/${l.file}.png`} file={`floorpad-${l.file}.png`} />
              </div>
            </div>
          ))}
        </div>
        <ul className="brand-rules">
          <li><b>Do</b> use the three supplied colourways as they are.</li>
          <li><b>Don&apos;t</b> stretch, rotate, outline, add glows or shadows, or redraw the mark.</li>
          <li><b>Don&apos;t</b> put the primary (mint) lockup on cream or photos; use a one-colour version.</li>
        </ul>
      </section>

      {/* ---------- colour ---------- */}
      <section className="section brand-section">
        <div className="row between wrap">
          <h2 className="section-title">Colour</h2>
          <Download href="/brand/assets/palette?download" label="Palette card" file="floorpad-palette.png" />
        </div>
        <p className="muted small brand-lede">
          Deep green ground, cream type, copper structure, gold for the level marker. Saturation stays calm; the logo mint is the
          one loud colour and belongs to the logo and mascot alone.
        </p>
        <div className="brand-grid five">
          {COLOURS.map(([name, hex, role]) => (
            <div key={hex} className="brand-colour">
              <div className="brand-chip" style={{ background: hex }} />
              <b>{name}</b>
              <span className="mono small">{hex}</span>
              <span className="xs muted">{role}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- type ---------- */}
      <section className="section brand-section">
        <h2 className="section-title">Type</h2>
        <div className="brand-grid two">
          <div className="panel stack" style={{ gap: 8 }}>
            <span className="xs muted">DISPLAY · COURIER NEW BOLD</span>
            <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: "2rem", lineHeight: 1.1 }}>
              Late buyers stop being exit liquidity.
            </div>
            <span className="small muted">Headlines, buttons, badges and labels. Tight tracking (-0.02em). Badges and labels in caps.</span>
          </div>
          <div className="panel stack" style={{ gap: 8 }}>
            <span className="xs muted">BODY & NUMBERS · JETBRAINS MONO</span>
            <div className="mono" style={{ fontSize: "1rem", lineHeight: 1.6 }}>
              Floor 0.0₈1176 N · Spot 0.0₆1205 N · every trade lays another layer.
            </div>
            <span className="small muted">Paragraphs, prices, addresses, tables. Tabular figures for every number.</span>
          </div>
        </div>
        <p className="xs muted" style={{ marginTop: 10 }}>Scale: 12 / 14 / 16 / 20 / 24 / 32px. Never below 12px. Share images use JetBrains Mono throughout.</p>
      </section>

      {/* ---------- motif ---------- */}
      <section className="section brand-section">
        <h2 className="section-title">The floor motif</h2>
        <div className="brand-grid three">
          <div className="panel stack" style={{ gap: 8 }}>
            <div className="brand-demo tiles" />
            <b>Tiled floor</b>
            <span className="small muted">The background: faint copper grout on Floor Green, 64px tiles.</span>
          </div>
          <div className="panel stack" style={{ gap: 8 }}>
            <div className="brand-demo planks" />
            <b>Copper planks</b>
            <span className="small muted">What things stand on: under the hero, above the footer, under every mascot.</span>
          </div>
          <div className="panel stack" style={{ gap: 8 }}>
            <div className="brand-demo steps"><i /><i /><i /><i /></div>
            <b>Rising slabs</b>
            <span className="small muted">Each source that feeds the vault adds a slab; steps always climb left to right.</span>
          </div>
        </div>
        <p className="xs muted" style={{ marginTop: 10 }}>
          One theme only: floors and rising levels. No circuits, rockets, charts-to-the-moon or lightning; they belong to other brands.
        </p>
      </section>

      {/* ---------- mascot ---------- */}
      <section className="section brand-section">
        <div className="row between wrap">
          <h2 className="section-title">The brick</h2>
          <Download href="/brand/assets/mascot-sheet?download" label="Mascot sheet" file="floorpad-mascot-sheet.png" />
        </div>
        <p className="muted small brand-lede">The mascot always stands on a floor, never floats. Use these graded files (transparent PNG); never recolour, stretch or crop off its feet.</p>
        <div className="brand-grid four">
          {POSES.map(([pose, use]) => (
            <div key={pose} className="panel brand-card">
              <div className="brand-swatch mascot" style={{ background: "var(--bg)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brand/graded/mascot-${pose}.png`} alt={`${pose} pose`} />
              </div>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <b style={{ textTransform: "capitalize" }}>{pose}</b>
                  <div className="xs muted">{use}</div>
                </div>
                <Download href={`/brand/graded/mascot-${pose}.png`} file={`floorpad-mascot-${pose}.png`} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- voice ---------- */}
      <section id="voice" className="section brand-section">
        <h2 className="section-title">Voice</h2>
        <div className="brand-grid two">
          <div className="panel stack" style={{ gap: 6 }}>
            <b className="green">Say</b>
            <span className="small">&ldquo;Every meme gets a floor.&rdquo;</span>
            <span className="small">&ldquo;Late buyers stop being exit liquidity.&rdquo;</span>
            <span className="small">&ldquo;Every trade lays another layer under a redeemable vault.&rdquo;</span>
            <span className="small">&ldquo;Redeem against the vault anytime.&rdquo;</span>
            <span className="xs muted">Plain, confident, a little playful. Show the mechanism; let numbers do the bragging.</span>
          </div>
          <div className="panel stack" style={{ gap: 6 }}>
            <b className="bad">Don&apos;t say</b>
            <span className="small">&ldquo;The floor only goes up&rdquo;, &ldquo;guaranteed&rdquo;, &ldquo;risk-free&rdquo;, &ldquo;can&apos;t lose&rdquo;.</span>
            <span className="small">&ldquo;Next-gen&rdquo;, &ldquo;revolutionary&rdquo;, &ldquo;to the moon&rdquo;.</span>
            <span className="xs muted">
              The floor is measured in NEAR/LiNEAR and its dollar value moves with NEAR. Promise the mechanism, never a price.
            </span>
          </div>
        </div>
        <div className="panel stack" style={{ marginTop: 10, gap: 6 }}>
          <b>Numbers</b>
          <span className="small muted">
            Brand graphics carry no fee figures: taxes are set per token and can change by DAO vote, and banners stay up for
            months. When a post needs numbers, take them from the <a className="green" href="/docs">Docs</a> page, which tracks
            the live contract, and say which token or network they apply to.
          </span>
        </div>
      </section>

      {/* ---------- social ---------- */}
      <section id="social" className="section brand-section">
        <h2 className="section-title">Social assets</h2>
        <p className="muted small brand-lede">Each file is sized for its platform. Click a preview to open it full size, or download the PNG.</p>
        <div className="brand-grid assets">
          {[{ name: "link-card", title: "Link preview", use: "What X, Telegram and Discord show when the site is shared (1200 × 630).", w: 1200, h: 630, href: "/opengraph-image" }, ...KIT.filter((a) => a.name !== "palette" && a.name !== "mascot-sheet").map((a) => ({ ...a, href: `/brand/assets/${a.name}` }))].map((a) => (
            <div key={a.name} className="panel brand-card">
              <a className="brand-preview" href={a.href} target="_blank" rel="noopener noreferrer" style={{ aspectRatio: `${a.w} / ${a.h}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.href} alt={a.title} loading="lazy" />
              </a>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div>
                  <b>{a.title}</b> <span className="xs muted mono">{a.w}×{a.h}</span>
                  <div className="xs muted">{a.use}</div>
                </div>
                <Download href={a.name === "link-card" ? a.href : `${a.href}?download`} file={`floorpad-${a.name}.png`} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
