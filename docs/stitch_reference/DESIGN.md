---
name: Balaghi Civic
colors:
  surface: '#f4fafd'
  surface-dim: '#d4dbdd'
  surface-bright: '#f4fafd'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eef5f7'
  surface-container: '#e8eff1'
  surface-container-high: '#e2e9ec'
  surface-container-highest: '#dde4e6'
  on-surface: '#161d1f'
  on-surface-variant: '#3f484b'
  inverse-surface: '#2b3234'
  inverse-on-surface: '#ebf2f4'
  outline: '#6f797c'
  outline-variant: '#bfc8cc'
  surface-tint: '#16677a'
  primary: '#126477'
  on-primary: '#ffffff'
  primary-container: '#357d91'
  on-primary-container: '#f9fdff'
  inverse-primary: '#8cd1e6'
  secondary: '#745b00'
  on-secondary: '#ffffff'
  secondary-container: '#fdd355'
  on-secondary-container: '#735a00'
  tertiary: '#33673d'
  on-tertiary: '#ffffff'
  tertiary-container: '#4b8054'
  on-tertiary-container: '#f7fff3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#b1ecff'
  primary-fixed-dim: '#8cd1e6'
  on-primary-fixed: '#001f27'
  on-primary-fixed-variant: '#004e5e'
  secondary-fixed: '#ffe08b'
  secondary-fixed-dim: '#ebc246'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#584400'
  tertiary-fixed: '#b7f1bb'
  tertiary-fixed-dim: '#9cd4a1'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#1c5129'
  background: '#f4fafd'
  on-background: '#161d1f'
  surface-variant: '#dde4e6'
typography:
  headline-xl:
    fontFamily: IBM Plex Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 38px
  headline-lg:
    fontFamily: IBM Plex Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 34px
  headline-sm:
    fontFamily: IBM Plex Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: IBM Plex Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: IBM Plex Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  caption:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  badge:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

The design system establishes a calm, reassuring, and accessible bridge between citizens and municipal authorities. Civic reporting often arises from frustration—infrastructure failure, waste accumulation, water leaks, or road hazards. Consequently, the interface avoids bureaucratic severity or alarms, opting instead for a modern, soft-UI aesthetic built on clarity, civic trust, and dignity.

The design movement blends **modern soft-UI minimalism** with human-centric tactile warmth:
- Generous breathing room (whitespace) that lessens cognitive burden under outdoor glare.
- Card-based surfaces with gentle edge curvature, micro-borders, and diffused ambient depth.
- Tactile, finger-friendly touch zones engineered strictly for handheld field usage.
- Native Right-to-Left (RTL) flow as the core structural paradigm, treating Arabic not as a localized afterthought but as the primary typographic anchor.

## Colors

The palette balances public-sector reliability with warm community optimism. 

- **Primary (`#4A90A4`)**: Soft Teal-Blue. Evokes institutional transparency, steady resolution, and calm authority without the rigidity of traditional police or military blues.
- **Accent / Call to Action (`#F2C94C`)**: Warm Amber. A noticeable yet welcoming signal color utilized for key focal actions (primary submission actions, highlighted status badges, and interactive map pins).
- **Background (`#F7F8FA`)**: Eye-soothing warm off-white canvas. Eliminates screen glare during high-sunlight outdoor usage across North African environments while preserving battery and visual softness.
- **Surface (`#FFFFFF`)**: Pure white elevated sheets, framing citizen reports cleanly over the tinted canvas.
- **Text & Neutral (`#2D3436`)**: Deep slate. Avoids optical vibration and stark contrast associated with raw `#000000`, paired with `#636E72` for secondary metadata and `#B2BEC3` for subtle borders.
- **Civic Status Semantics**:
  - *New Submission*: Soft Blue (`#6C9BD1`) on tinted wash (`#EDF4FB`)
  - *Under Review / In Progress*: Soft Amber (`#E8B86D`) on tinted wash (`#FDF8EE`)
  - *Resolved / Closed*: Soft Green (`#7FB685`) on tinted wash (`#F0F8F2`)

## Typography

The typography strategy unites Arabic typographic clarity through **IBM Plex Sans** (paired dynamically with IBM Plex Sans Arabic in implementation) and Latin functional precision through **Inter**.

- **Arabic Considerations**: IBM Plex Sans Arabic provides open counters, balanced baselines, and clear diacritic visibility. A deliberate `1.5x - 1.6x` line-height is enforced systematically to prevent complex Arabic ascenders and descenders from clipping or visually crowding adjacent rows.
- **Directionality & Hierarchy**: Text alignment defaults to right-aligned (`text-align: right`) for RTL contexts. Numeric indicators (ticket IDs, tracking numbers, and metric counters) use tabular numerals for effortless visual scanning in status logs.

## Layout & Spacing

The layout operates on a mobile-first fluid column structure governed by an 8px base rhythm (with 4px half-steps for micro-alignments).

- **Mobile Canvas**: 4 fluid columns with `1.25rem` (20px) outer safe margins and `1rem` (16px) gutters. Cards span full width (4 columns) to maximize readable content area and thumb accuracy.
- **Tablet / Large Formats**: Centers content within a constrained max-width of `640px` to maintain focused single-hand or thumb-driven usage without stretching report cards or forms into unreadable horizontal spans.
- **Touch Ergonomics**: All interactive zones enforce a strict minimum boundary of `48px x 48px` (exceeding the standard 44px threshold) to facilitate one-handed outdoor usage and accessibility for elderly or visually impaired citizens.

## Elevation & Depth

Visual depth avoids stark drop shadows, employing instead a dual-layer soft elevation system that feels organic and integrated with the off-white surface:

- **Base Card Elevation**: `0px 2px 8px -2px rgba(45, 52, 54, 0.05), 0px 1px 3px 0px rgba(45, 52, 54, 0.03)`. Surfaces are reinforced with a micro-border: `1px solid rgba(45, 52, 54, 0.06)` to retain crisp definition under bright ambient light.
- **Floating Controls & Modals**: `0px 8px 24px -4px rgba(74, 144, 164, 0.16), 0px 4px 12px -2px rgba(45, 52, 54, 0.06)`. Applied strictly to the elevated central Action Button (+) and bottom navigation sheets.
- **Active / Pressed State**: Eliminates shadow offset entirely and transitions card borders to `rgba(74, 144, 164, 0.4)` for instant tactile feedback.

## Shapes

The design system maintains a consistent rounded geometry centered around `16px` to `20px` corners, providing a friendly, approachable, non-threatening civic identity.

- **Primary Cards & Containers**: `16px` to `18px` (`rounded-lg`).
- **Interactive Inputs & Buttons**: `14px` to `16px`.
- **Status Tags, Category Chips, & Floating Action Button**: Fully pill-shaped (`9999px`) to immediately separate actionable tags and navigation triggers from structural content panels.

## Components

### Buttons
- **Primary CTA**: Filled with Accent Warm Amber (`#F2C94C`) with Dark Slate text (`#2D3436`), `52px` height, full pill or `16px` curvature, bold weight (`600`).
- **Civic Action (Submit Report)**: Soft Teal-Blue (`#4A90A4`) with pure white text, providing clear visual prominence for civic duties.
- **Secondary / Ghost**: Background `rgba(74, 144, 164, 0.08)`, text `#4A90A4`, zero border.

### Status Chips & Badges
- Compact height (`28px`), pill-rounded (`9999px`), consisting of a `6px` circular status indicator dot followed by bilingual or Arabic label.
- Color combinations rely on the pastel status tokens:
  - *New (جديد)*: Soft Blue tint background, dark blue text.
  - *In Progress (قيد المعالجة)*: Soft Amber tint background, warm ochre text.
  - *Resolved (تم الحل)*: Soft Green tint background, forest green text.

### Report Cards
- Container: White surface (`#FFFFFF`), `16px` radius, subtle perimeter border (`rgba(45, 52, 54, 0.06)`).
- Layout: RTL oriented with incident thumbnail/map preview (`72px x 72px`, `12px` rounded) placed on the physical right, followed by status badge, title (`title-md`), location caption, and relative timestamp (`caption`) flowing leftward.

### Form Inputs & Media Attachments
- Fields: `52px` height, light fill (`#FFFFFF`), border `1px solid rgba(45, 52, 54, 0.12)`, `14px` corner radius. Focused state applies `#4A90A4` border with a subtle 3px spread ring (`rgba(74, 144, 164, 0.12)`).
- Image Upload Tile: Dashed border (`1.5px dashed #4A90A4`), soft tinted background (`rgba(74, 144, 164, 0.04)`), featuring an intuitive camera icon alongside Arabic prompt (*إرفاق صورة أو فيديو*).

### Bottom Navigation Bar
- Fixed bottom dock featuring a subtle blur backdrop (`rgba(255, 255, 255, 0.92)` with `16px` blur) and top border (`rgba(45, 52, 54, 0.06)`).
- Items: 4 primary navigation nodes with icons centered above 11px micro-labels.
- Floating Center Button (إبلاغ / Report): Prominent `56px` circular action hub, elevated `-18px` above the tab bar plane in Warm Amber (`#F2C94C`) with a deep ambient shadow, inviting immediate civic participation.