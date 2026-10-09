# T022 — Build the base component library

**Epic:** E9 (Client shell)
**Spec sections:** §6.4, §7 (§7.3 Breadcrumb), §8 (§8.2 Slider), §10, NFR-6
**Depends on:** T020, T021
**Estimated size:** L

---

## 1. Context

Slydr's three screens (explorer, configuration, player) are assembled from a small set of shared UI building blocks: buttons, checkboxes, a slider, icons, a breadcrumb trail, chips, notices and loading placeholders. The configuration screen (T029) is built from this library's `Checkbox` and `Slider` and does not re-implement either. This ticket builds that library under `client/src/components/` so every later screen ticket composes ready-made, accessible, themed pieces instead of re-deriving focus rings, touch-target sizes and ARIA wiring.

Each component is styled with CSS Modules using design tokens only (no literal colours), shows a visible focus ring built from `--focus-ring`, meets the 44 x 44 px minimum touch target (48 x 48 px on coarse pointers), guards hover-only affordances behind `@media (hover: hover)`, and is correct in both the light and dark themes. The accessibility behaviour is the point of the exercise: WCAG 2.1 AA (NFR-6) is only achievable if these primitives are right once, here.

## 2. Scope

### In scope

- Components under `client/src/components/`: `Button`, `IconButton`, `Checkbox`, `Slider`, `Icon`, `Breadcrumb`, `Chip`, `Banner`, `Skeleton`, `Spinner`.
- A barrel file `client/src/components/index.ts`.
- A shared internal hook for the breadcrumb menu and a shared `visuallyHidden` convention (reusing the global `.sr-only` class from T020).
- The ARIA, keyboard and touch-target behaviour described per component.
- A dev-only component gallery page (decision in section 4.13).
- RTL tests for each component, including type-level tests, under `client/test/components/`.

`lucide-react` and `@testing-library/user-event` are already dependencies (T001); this ticket adds no dependency.

### Out of scope

- Design tokens, `base.css`, the focus-visible rule, `cx` helper and the CSS Modules convention — **T020** (already done; consumed here).
- The theme system, `useTheme` and the theme toggle button (`ThemeToggle`) — **T021**. It is not part of this library; screens import it from `client/src/components/ThemeToggle/`.
- The configuration screen's own layout and its use of `Checkbox` and `Slider` — **T029**.
- Screen layouts (explorer, configuration, player) and their screen-specific controls, including the player's controls pill — **T026 onwards**.
- The explorer's entry rows, tiles and virtualised list — E11 to E13.
- Data fetching, state providers and persistence — E10.
- A modal or dialog primitive. The breadcrumb overflow menu is a small popup local to `Breadcrumb`; no general-purpose `Menu` or `Popover` component is built here.

## 3. Prerequisites and assumed state

The repository is an npm workspaces monorepo with `shared/`, `server/` and `client/`, ESM throughout, TypeScript 5.x strict (including `noUncheckedIndexedAccess`), Node >= 22. The client is Vite 7 with React 19, tested with Vitest and React Testing Library in `jsdom` (T002): Vitest globals are **off** (tests import `describe`, `it`, `expect`, `vi` from `'vitest'`), only `client/test/**/*.test.{ts,tsx}` is discovered, CSS Modules use `classNameStrategy: 'non-scoped'` (class names are stable in tests), and `client/test/setup.ts` loads `@testing-library/jest-dom/vitest` and cleans up after each test. `@testing-library/user-event` and `lucide-react` are already installed (T001).

### From T020 (design tokens, already present)

`client/src/styles/tokens.css` defines, for both themes: `--bg`, `--bg-elevated`, `--bg-sunken`, `--fg`, `--fg-muted`, `--border` (3:1 against `--bg`), `--border-subtle` (decorative only), `--accent`, `--accent-fg`, `--accent-hover`, `--accent-active`, `--focus-ring`, `--danger`, `--danger-fg`, `--overlay-bg`, `--overlay-fg`, `--shadow-1`, `--shadow-2`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`, `--space-1` to `--space-8` (4, 8, 12, 16, 24, 32, 48, 64 px), `--font-ui`, `--text-xs|sm|md|lg|xl|2xl`, `--leading-tight`, `--leading-normal`, `--dur-fast` (120ms), `--dur-base` (200ms), `--dur-slow` (320ms), `--ease-standard`, `--target-min` (`2.75rem`, 44 px), `--target-min-coarse` (`3rem`, 48 px), `--page-gutter`.

`client/src/styles/base.css` provides the global `:focus-visible` ring (`outline: 2px solid var(--focus-ring); outline-offset: 2px;` with deliberately **no** `border-radius`, so pill and circular controls keep their shape), a `.focus-ring-inset` utility, a `.sr-only` utility, and the reduced-motion safety net. Breakpoints are the literal values `480px`, `768px`, `1024px`, `1440px` in `min-width` media queries only. CSS Modules are the component styling mechanism: `Component/Component.module.css` beside `Component.tsx`, `camelCase` class names, imported as `import styles from './Component.module.css'`. `client/src/lib/cx.ts` exports:

```ts
export function cx(...parts: Array<string | false | null | undefined>): string;
```

There is a test that fails if any hex, `rgb()` or `hsl()` colour literal appears in client source outside `tokens.css`. These components must pass it.

### From T021 (theme system, already present)

`useTheme()`, `ThemeToggle`, the `data-theme` attribute on `<html>`, and the anti-FOUC script exist. Components in this ticket never read the theme; they only use tokens, and the token swap makes them correct in both themes. No component here needs to know the current theme.

### From `@slydr/shared`

```ts
export function breadcrumbSegments(path: string): { label: string; path: string }[];
```

Given a POSIX wire path relative to the jail root, returns one entry per level. The first entry is always `{ label: 'Home', path: '' }`. Example: `breadcrumbSegments('Pictures/2024/summer')` returns `[{ label: 'Home', path: '' }, { label: 'Pictures', path: 'Pictures' }, { label: '2024', path: 'Pictures/2024' }, { label: 'summer', path: 'Pictures/2024/summer' }]`. `breadcrumbSegments('')` returns just the Home entry.

### Dependencies

`lucide-react` (tree-shaken icons; the specification names it in §2.3) is already in `client/package.json` `dependencies` (T001; do not change its version). Import icons by name (`import { Folder } from 'lucide-react'`), never the whole namespace, so tree-shaking keeps the bundle under the NFR-8 budget.

## 4. Implementation detail

### 4.1 File layout

```
client/src/components/
  index.ts                      # barrel
  Button/        Button.tsx  Button.module.css  index.ts
  IconButton/    IconButton.tsx  IconButton.module.css  index.ts
  Checkbox/      Checkbox.tsx  Checkbox.module.css  index.ts
  Slider/        Slider.tsx  Slider.module.css  index.ts
  Icon/          Icon.tsx  Icon.module.css  index.ts
  Breadcrumb/    Breadcrumb.tsx  Breadcrumb.module.css  index.ts  useBreadcrumbLayout.ts
  Chip/          Chip.tsx  Chip.module.css  index.ts
  Banner/        Banner.tsx  Banner.module.css  index.ts
  Skeleton/      Skeleton.tsx  Skeleton.module.css  index.ts
  Spinner/       Spinner.tsx  Spinner.module.css  index.ts
  gallery/       Gallery.tsx  Gallery.module.css      # dev-only, section 4.13

client/test/components/
  Button.test.tsx               # tests mirror src/ and live under client/test/ only
  ...                           # one <Component>.test.tsx per component, plus barrel.test.ts and Gallery.test.tsx
```

`ThemeToggle` (T021) lives in `client/src/components/ThemeToggle/` but is **not** part of this barrel.

Each component's `index.ts` re-exports the component and its prop types:

```ts
// components/Button/index.ts
export { Button } from './Button';
export type { ButtonProps } from './Button';
```

The barrel `components/index.ts` re-exports every component and every public prop type, and nothing else (the gallery is **not** exported from the barrel, so it can be tree-shaken out of production):

```ts
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { Slider } from './Slider';
export type { SliderProps } from './Slider';
export { Icon } from './Icon';
export type { IconProps, IconComponent } from './Icon';
export { Breadcrumb } from './Breadcrumb';
export type { BreadcrumbProps } from './Breadcrumb';
export { Chip } from './Chip';
export type { ChipProps } from './Chip';
export { Banner } from './Banner';
export type { BannerProps, BannerVariant } from './Banner';
export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
```

### 4.2 Cross-cutting rules (apply to every component)

1. **Tokens only.** Every colour, spacing, radius, font size, duration and easing comes from a `var(--...)`. No hex, `rgb()`, `hsl()` or named colour; no `px` font size; no literal `ms` durations (use `--dur-*`).
2. **Focus ring.** The global `:focus-visible` rule in `base.css` already draws `outline: 2px solid var(--focus-ring); outline-offset: 2px`. Components must not set `outline: none`. For elements clipped by `overflow: hidden` ancestors (Chip with a close button, breadcrumb menu items) use the global `.focus-ring-inset` class or replicate its `box-shadow` recipe with tokens. A component that contains a native `<input>` hidden visually (Checkbox) must draw the ring on the visible sibling using `:focus-visible` on the input (`input:focus-visible + .box`).
3. **Touch targets.** Every interactive element has `min-height: var(--target-min); min-width: var(--target-min);` and, inside `@media (pointer: coarse)`, `min-height: var(--target-min-coarse); min-width: var(--target-min-coarse);`. Where the visible control is smaller than the target (the Checkbox box, the Slider thumb, a Chip close button), enlarge the hit area with padding or a transparent `::before` pseudo-element, not by inflating the visible shape. Text-only buttons that stretch to content width still keep the minimum height and a minimum width of the target.
4. **Hover.** Every `:hover` rule is wrapped in `@media (hover: hover) { ... }`. Every hover style has a pressed (`:active`) or focus equivalent, so touch devices get feedback.
5. **Both themes.** No component contains theme-specific CSS. A component stays correct purely through tokens. Verify manually in both themes (section 7).
6. **Reduced motion.** Transitions use `var(--dur-fast)` or `var(--dur-base)` with `var(--ease-standard)`. The global reduced-motion rule from T020 neutralises them. The Spinner's rotation is the only continuous animation; it is slowed rather than removed under reduced motion (section 4.10).
7. **Forwarding.** Components that wrap a native element accept that element's remaining attributes via rest props (`React.ComponentPropsWithoutRef<'button'>` and so on) and forward `ref` as an ordinary prop (React 19 passes `ref` as a prop to function components; do not use `forwardRef`). `className` is merged with `cx`, never replaced.
8. **No side effects at import.** No component touches `window` or `document` at module scope.
9. **Strictness.** No `any`, no non-null assertions on props, code that compiles under `noUncheckedIndexedAccess` (an indexed access such as `segments[n - 2]` is `T | undefined`; narrow it). All props interfaces below are exported.
10. **IDs.** Generate ids with `React.useId()`. Never hand-roll counters.

### 4.3 `Icon`

A thin wrapper around a `lucide-react` icon component. Icons are decorative by default because they nearly always sit beside or inside text or a labelled button; a meaningful standalone icon must opt in with a `label`.

```ts
import type { LucideIcon } from 'lucide-react';

export type IconComponent = LucideIcon;

export interface IconProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, 'children' | 'aria-label' | 'aria-hidden'> {
  /** The lucide icon component to render, e.g. `Folder`. */
  icon: IconComponent;
  /** Pixel size of the square icon. Default 20. */
  size?: number;
  /** Stroke width. Default 2. */
  strokeWidth?: number;
  /**
   * When provided, the icon is meaningful: it gets role="img" and aria-label={label}.
   * When omitted, the icon is decorative: aria-hidden="true", no role, not focusable.
   */
  label?: string;
}
```

Behaviour:

- Decorative (default): renders `<svg aria-hidden="true" focusable="false">`. `focusable="false"` prevents legacy Edge/IE from putting an SVG into the tab order.
- With `label`: renders `<svg role="img" aria-label={label} focusable="false">` and no `aria-hidden`.
- Uses `currentColor` (lucide default) so the colour is inherited from the surrounding text token. Never accepts a colour prop.
- Size defaults to `20`; the `Icon` sets `width`/`height` through the lucide `size` prop. Icon sizes in CSS elsewhere use `rem`; the numeric prop is the one allowed use of a pixel number because SVG intrinsic sizing needs it.
- `Icon.module.css` contains only `.icon { flex: none; display: inline-block; vertical-align: middle; }`. An icon never shrinks inside a flex row.

### 4.4 `Button` and `IconButton`

`Button` offers three visual variants and, per the requirement that icon-only buttons need an accessible name, a **discriminated union** makes it a type error to render an icon-only button without an `aria-label`.

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

interface ButtonBaseProps
  extends Omit<React.ComponentPropsWithoutRef<'button'>, 'children' | 'type'> {
  variant?: ButtonVariant;          // default 'secondary'
  size?: ButtonSize;                // default 'md'
  type?: 'button' | 'submit' | 'reset'; // default 'button' (never the HTML default of 'submit')
  loading?: boolean;                // default false; shows a Spinner, sets aria-busy, blocks clicks
  fullWidth?: boolean;              // default false
  ref?: React.Ref<HTMLButtonElement>;
}

/** A button with a visible text label. An icon may accompany the text. */
export interface LabelledButtonProps extends ButtonBaseProps {
  children: React.ReactNode;        // required, non-empty visible label
  icon?: IconComponent;             // optional leading icon (decorative)
  iconOnly?: false;                 // default
  'aria-label'?: string;            // optional override; avoid unless the visible text is ambiguous
}

/** A button with only an icon. `aria-label` is REQUIRED by the type system. */
export interface IconOnlyButtonProps extends ButtonBaseProps {
  iconOnly: true;
  icon: IconComponent;
  'aria-label': string;             // required
  children?: never;                 // an icon-only button has no visible text children
}

export type ButtonProps = LabelledButtonProps | IconOnlyButtonProps;
```

Behaviour and structure:

- Renders a native `<button>`; never a `div` or `a`. `type` defaults to `'button'` so a button inside a future `<form>` does not submit it by accident.
- The `iconOnly` branch renders just the `Icon` with `size` 20 (md) or 24 (lg), and the element is a square at least `var(--target-min)` wide and high.
- `loading`: renders a `Spinner` (size `1em`) before the label, sets `aria-busy="true"`, sets `aria-disabled="true"` and **ignores clicks** in the handler (do not use the native `disabled` attribute for the loading state, so focus is not lost mid-operation). The width of the button must not change when loading toggles: keep the label rendered and visible, and position the spinner in the existing left padding or reserve its space.
- `disabled` uses the native attribute (inherited from rest props). Disabled styling: `opacity: 0.5` plus `cursor: not-allowed`, and the text must still be readable; disabled controls are exempt from WCAG contrast but do not reduce them below 3:1 on `--bg`.
- Variants (all by token):
  - `primary`: `background: var(--accent); color: var(--accent-fg); border: 1px solid transparent`. Hover (guarded) uses `--accent-hover`; `:active` uses `--accent-active`.
  - `secondary`: `background: var(--bg-elevated); color: var(--fg); border: 1px solid var(--border)`. Hover (guarded) `background: var(--bg-sunken)`.
  - `ghost`: `background: transparent; color: var(--fg); border: 1px solid transparent`. Hover (guarded) `background: var(--bg-sunken)`. A ghost button's resting state has no visible boundary, which is acceptable because its text or icon is the control and meets 4.5:1 / 3:1. **The variant and size sets are closed** (`primary | secondary | ghost`, `md | lg`): there is no `link` variant and no `sm` size. Text-link-style actions elsewhere in the app ("Back to file explorer", "Reset to defaults", "Choose another folder") use `variant="ghost"` at `size="md"`, which keeps the 44 px touch target. Consumers pressing a toggle-style icon button use `IconButton`'s `pressed` prop, never a hand-written `aria-pressed`.
- Geometry: `min-height: var(--target-min)`, `padding-inline: var(--space-4)`, `border-radius: var(--radius-md)`, `font: inherit` at `var(--text-md)`, `gap: var(--space-2)`, `display: inline-flex; align-items: center; justify-content: center`. `size="lg"` raises `min-height` to `var(--target-min-coarse)` and uses `--text-lg`. `@media (pointer: coarse)` raises `min-height` and `min-width` to `var(--target-min-coarse)` on all sizes.
- `transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)`.
- `white-space: nowrap` by default; labels are short. Do not clip text; if a label must wrap on narrow screens the consumer overrides with `className`.

`IconButton` is a convenience component with the `iconOnly` branch baked in, used throughout the app for toolbar-style controls:

```ts
export interface IconButtonProps
  extends Omit<React.ComponentPropsWithoutRef<'button'>, 'children' | 'type' | 'aria-label'> {
  icon: IconComponent;
  /** Accessible name. Required. Also used as the default tooltip. */
  'aria-label': string;
  variant?: ButtonVariant;       // default 'ghost'
  size?: ButtonSize;             // default 'md'
  type?: 'button' | 'submit' | 'reset'; // default 'button'
  /** Optional pressed state for a toggle-style icon button (e.g. view mode). Sets aria-pressed. */
  pressed?: boolean;
  /** Native tooltip. Defaults to the aria-label. Pass `false`-like empty string to suppress. */
  title?: string;
  ref?: React.Ref<HTMLButtonElement>;
}
```

- It renders `<Button iconOnly icon={icon} aria-label={...} variant={variant ?? 'ghost'} .../>`, so the type-level and runtime guarantees come from one place.
- `pressed` maps to `aria-pressed={pressed}` only when it is a boolean (omit the attribute when `undefined`). A pressed ghost button also gets `background: var(--bg-sunken)` and `color: var(--accent)`.
- `title` defaults to the `aria-label` so mouse users get a tooltip; touch users rely on the icon. Because `aria-label` and `title` are identical, assistive technology does not announce the name twice.
- **Runtime guard (development only):** if `aria-label` is missing or empty at runtime (a JavaScript caller or an `as any`), log `console.error('IconButton requires a non-empty aria-label.')` once when `import.meta.env.DEV` is true. Do not throw.

### 4.5 `Checkbox`

**Owner decision (requirements and spec §8.2 say "checkbox"): every boolean option in the app is presented as a checkbox, not a switch.** `Checkbox` is a native `<input type="checkbox">` with a visible `<label>`, **no** `role="switch"`, and a box-and-tick visual drawn from tokens. Screen readers therefore announce "checkbox, checked / not checked", which is what the requirements ask for. Native checkbox keeps free keyboard handling (`Space` toggles), free `change` events and free focus behaviour. The checked state is the native `checked`; do not add `aria-checked` (it would duplicate and could drift). The real input is visually hidden but stays focusable and sits in the layout with the label.

```ts
export interface CheckboxProps
  extends Omit<
    React.ComponentPropsWithoutRef<'input'>,
    'type' | 'role' | 'checked' | 'defaultChecked' | 'onChange' | 'children' | 'size'
  > {
  /** Visible label text. Required; there is no label-less checkbox. */
  label: React.ReactNode;
  /** Optional secondary text linked with aria-describedby, e.g. "Play them in random order". */
  description?: React.ReactNode;
  /**
   * Optional extra text rendered OUTSIDE the label and linked with aria-describedby
   * (for example the reduced-motion note of T029). It never becomes part of the accessible name.
   */
  note?: React.ReactNode;
  checked: boolean;                       // controlled only
  onCheckedChange: (checked: boolean) => void;
  ref?: React.Ref<HTMLInputElement>;
}
```

Structure (the `note`, when present, is a sibling of the `<label>` inside a wrapping `<div>`):

```tsx
<div className={styles.wrapper}>
  <label className={styles.root} htmlFor={id}>
    <input id={id} type="checkbox" className={styles.input}
           checked={checked} onChange={(e) => onCheckedChange(e.currentTarget.checked)}
           aria-describedby={describedBy} {...rest} />
    <span className={styles.box} aria-hidden="true"><Check className={styles.tick} size={16} strokeWidth={3} /></span>
    <span className={styles.text}>
      <span className={styles.label}>{label}</span>
      {description && <span id={descId} className={styles.description}>{description}</span>}
    </span>
  </label>
  {note && <p id={noteId} className={styles.note}>{note}</p>}
</div>
```

`describedBy` joins `descId` and/or `noteId` with a space (undefined when neither exists); a caller-supplied `aria-describedby` in `rest` is appended to that list rather than replacing it. The tick is the lucide `Check` icon imported by name.

Styling:

- The whole `<label>` row is the hit target: `min-height: var(--target-min)` (and `--target-min-coarse` on coarse pointers), `display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer`. Clicking the text toggles it. The box is vertically aligned with the first line of the label.
- `.input` is visually hidden with the standard clip recipe (`position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0`). Never `display: none` or `visibility: hidden`, which would remove it from the tab order.
- `.box`: `flex: none; width: 1.25rem; height: 1.25rem; border-radius: var(--radius-sm); background: var(--bg); border: 2px solid var(--border)` (3:1 non-text contrast); it is smaller than the 44 px target, whose size comes from the label row. Checked state (`.input:checked + .box`): `background: var(--accent); border-color: var(--accent); color: var(--accent-fg)`, and the `.tick` becomes visible (`opacity: 0` unchecked, `1` checked). The state is not conveyed by colour alone: the tick appears, which satisfies WCAG 1.4.1.
- Focus: `.input:focus-visible + .box { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`.
- Disabled: native `disabled` passes through; `.input:disabled + .box { opacity: 0.5 }` and the label gets `cursor: not-allowed`.
- Hover (guarded): `.root:hover .box { border-color: var(--accent) }`.
- Motion: `background-color`, `border-color` and the tick `opacity` over `var(--dur-fast)`.
- `description` and `note` text is `var(--text-sm)` in `var(--fg-muted)`.

### 4.6 `Slider`

Wraps a native `<input type="range">` with a live numeric readout and the keyboard contract of specification §8.2: **arrow keys change the value by 1, `PageUp`/`PageDown` by 5**.

```ts
export interface SliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<'input'>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'children' | 'size'
  > {
  /** Visible label. Required. */
  label: React.ReactNode;
  value: number;                          // controlled only
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  /** Arrow-key and pointer step. Default 1. */
  step?: number;
  /** PageUp/PageDown step. Default 5. */
  pageStep?: number;
  /** Formats the number for the visible readout, e.g. (v) => `${v} s`. Default: String(v). */
  formatValue?: (value: number) => string;
  /**
   * Formats the number for aria-valuetext (the spoken form), e.g. (v) => `${v} seconds`.
   * Default: the same function as `formatValue`.
   */
  formatValueText?: (value: number) => string;
  ref?: React.Ref<HTMLInputElement>;
}
```

Structure and behaviour:

- Render `<label htmlFor={id}>` with the visible label, an `<output htmlFor={id}>` showing `formatValue(value)`, and `<input id={id} type="range" min max step value>`.
- `aria-valuetext={(formatValueText ?? formatValue)(value)}` so a screen reader announces "5 seconds" (or "5 s" with the default) rather than "5". (Native range already exposes `aria-valuenow`/`min`/`max`; do not duplicate them.)
- The `<output>` element is a live region by default (implicit `role="status"`, polite). That would make a screen reader announce every step of a drag on top of the announcement the slider itself makes from `aria-valuetext`, which is noisy and doubled. **Decision (not specified):** set `aria-live="off"` on the `<output>`. The "live numeric readout" the specification asks for is the visible text that updates on every `input` event; the spoken value comes from `aria-valuetext` on the input, giving exactly one clean announcement. Do not add `aria-live` to the input.
- **Keyboard contract.** Native range behaviour differs by browser: arrow keys step by `step`; `PageUp`/`PageDown` step by a large browser-specific increment (commonly 10 % of the range, e.g. 3 on a 1 to 30 range), and `Home`/`End` jump to the ends. To honour "PageUp/PageDown +-5" implement a `keydown` handler on the input:

```ts
function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  rest.onKeyDown?.(e);
  if (e.defaultPrevented) return;
  let delta = 0;
  if (e.key === 'PageUp') delta = pageStep;
  else if (e.key === 'PageDown') delta = -pageStep;
  else return;                       // arrows, Home, End: leave to the browser
  e.preventDefault();                // suppress the native large step
  const next = clamp(roundToStep(value + delta, min, step), min, max);
  if (next !== value) onValueChange(next);
}
```

  - `preventDefault()` is essential: without it the browser also applies its own page step and the value moves twice.
  - Arrow keys (`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`) are **not** intercepted; the native `step` of `1` already gives +-1 and works identically everywhere. `Home` and `End` also stay native.
  - `roundToStep(v, min, step)` snaps to `min + k*step` and trims floating-point noise (`Number(x.toFixed(10))`).
  - `onChange` of the native input calls `onValueChange(Number(e.currentTarget.value))`.
  - The handler must not fire when a modifier key is held (`e.altKey || e.ctrlKey || e.metaKey`) so browser and screen-reader shortcuts are not swallowed.
- Pointer and touch: native. `touch-action: pan-y` on the input so a horizontal drag on a touch screen moves the thumb instead of scrolling.
- Styling (cross-browser; both `::-webkit-slider-*` and `::-moz-range-*` pseudo-elements are required, and must be in **separate rules**, since an unknown pseudo-element invalidates a whole selector list):
  - `appearance: none; width: 100%; height: var(--target-min); background: transparent`, with the touch target height from the input itself (`--target-min-coarse` on coarse pointers).
  - Track: `height: 0.375rem; border-radius: var(--radius-pill); background: var(--bg-sunken); border: 1px solid var(--border)`. Filled portion: set a CSS custom property `--slider-fill` (a percentage) inline from the component (`style={{ '--slider-fill': `${pct}%` }}`) and use `linear-gradient(to right, var(--accent) var(--slider-fill), var(--bg-sunken) var(--slider-fill))` as the track background. This is the only inline style allowed in the library and carries a number, not a colour.
  - Thumb: `1.5rem` circle, `background: var(--accent)`, `border: 2px solid var(--bg)`, `box-shadow: var(--shadow-1)`; the thumb is smaller than the 44 px target, whose size comes from the input's height.
  - Focus: `input:focus-visible::-webkit-slider-thumb` and `::-moz-range-thumb` get `outline: 2px solid var(--focus-ring); outline-offset: 2px`. Also keep the global ring on the input itself with `outline-offset: 2px`; simplest is to leave the input's own `:focus-visible` outline in place and let the thumb additionally enlarge. At least one visible indicator is mandatory.
  - Layout: label and readout on one row (`display: flex; justify-content: space-between; align-items: baseline`), the readout in `var(--fg-muted)` with `font-variant-numeric: tabular-nums` so the digits do not jitter.
  - `disabled` greys the track and thumb using `opacity: 0.5`.
- If `value` is outside `[min, max]` or not finite, clamp for display; never pass `NaN` to the DOM.

### 4.7 `Breadcrumb`

Renders the path trail for the explorer header (specification §7.3): segments derived from the wire path, rooted at "Home", each segment a button that navigates to that depth. When the trail does not fit, the middle collapses into an ellipsis button that opens a menu of the hidden segments. **"Home" and the last two segments are always visible**, unless the caller sets `maxVisibleSegments` (used by the explorer below 768 px; see below).

```ts
export interface BreadcrumbProps {
  /** Wire path of the current folder, POSIX, relative to the jail root. "" is the root. */
  path: string;
  /** Called with the wire path of the segment the user chose. "" means Home. */
  onNavigate: (path: string) => void;
  /**
   * Optional tooltip for the Home segment (the explorer passes RootResponse.absoluteRoot so the
   * user can see where Home is). Set as the `title` attribute only; it never changes the
   * accessible name, which stays "Home". Display text only, never sent back to the server.
   */
  rootTitle?: string;
  /** Accessible name of the <nav> landmark. Default "Breadcrumb". */
  'aria-label'?: string;
  /** Optional class for the outer <nav>. */
  className?: string;
  /** Test seam: forces a maximum number of visible segments, bypassing measurement. */
  maxVisibleOverride?: number;
  /**
   * Product-level cap on how many trail segments are shown (the last one included). Undefined (the
   * default) keeps the standard "Home + collapsible middle + last two" layout. When set to m >= 1
   * the trail shows only the last min(m, n) segments, preceded by the ellipsis button when n > m;
   * every other segment, Home first, is listed in the overflow menu in path order. The explorer
   * (T035) passes 1 below 768 px (spec §10: "breadcrumb collapses aggressively") and leaves it
   * undefined from 768 px up. Values below 1 are treated as 1.
   */
  maxVisibleSegments?: number;
}
```

#### Semantics

- Outer element `<nav aria-label="Breadcrumb">` containing an `<ol>`; each item is an `<li>` containing a `<button type="button">`. A list conveys the number of levels to a screen reader.
- The **last segment** (the current folder) is not an action: render it as `<span aria-current="page">` rather than a button. **Decision (not specified):** the current folder is a non-interactive label. Navigating to the folder you are already in is a no-op and would only add a pointless tab stop. It is still at least `var(--target-min)` tall for visual rhythm but not focusable.
- Separators are decorative: render a `ChevronRight` `Icon` (aria-hidden) in a `<span aria-hidden="true">` between items, or a CSS `::before` on the `<li>`; never text characters that a screen reader would read as "slash".
- The Home segment is a button with the visible text "Home" (label from `breadcrumbSegments`). **Decision (not specified):** show a `Home` lucide icon beside the text at widths `>= 480px` and the icon alone below it, with `aria-label="Home"` remaining on the button in both cases. The button's accessible name is "Home" in all layouts, so tests can rely on `getByRole('button', { name: 'Home' })`. When `rootTitle` is given it is set as the Home button's `title` (when Home is the current location, `path === ''`, it is set on the non-interactive `aria-current` element instead). The component takes the `path`, not pre-split segments; callers (T026) pass `state.explorer.path` and `onNavigate`.
- Long segment names truncate with an ellipsis (`max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) and carry a `title` equal to the full label. The last segment may use `max-width: 16rem`.

#### Collapse algorithm

Let `segments = breadcrumbSegments(path)` and `n = segments.length`.

1. If `n <= 3`, nothing can be collapsed: Home plus up to two further segments are all "always visible". Render everything; no ellipsis button.
2. Otherwise, the pinned set is `segments[0]` (Home) and `segments[n-2]`, `segments[n-1]` (the last two). The collapsible middle is `segments[1 .. n-3]`.
3. The component renders a visible prefix and suffix and, between them, an ellipsis button standing in for the hidden middle segments. The number of middle segments kept visible, `k`, is determined by measurement (next section) and ranges from `0` to `n - 3`. When `k` middle segments are visible they are the **ones nearest the end** of the middle (the deepest), because they are the most useful context: visible order is `Home`, `…`, `segments[n-2-k .. n-3]` (the kept middle), `segments[n-2]`, `segments[n-1]`. When `k === n - 3` there is no ellipsis.
4. The hidden segments are `segments[1 .. n-3-k]`, listed in the menu in path order (shallowest first).

#### Width measurement with `ResizeObserver`

Put the logic in `useBreadcrumbLayout.ts`:

```ts
function useBreadcrumbLayout(
  segmentCount: number,
  deps: unknown[],
  override?: number,
): {
  containerRef: React.RefObject<HTMLElement | null>;
  measureRef: React.RefObject<HTMLElement | null>;
  visibleMiddle: number; // k
};
```

Approach (a hidden measuring clone, so the visible DOM never flickers):

1. Render, inside the `<nav>`, a second `<ol>` marked `aria-hidden="true"` and `inert`, with `visibility: hidden; position: absolute; pointer-events: none; height: 0; overflow: hidden; white-space: nowrap`, containing **all** segments un-collapsed, plus one ellipsis button. Do not render it when `maxVisibleOverride` is set. It is not in the accessibility tree (`aria-hidden` plus `inert`), so it adds no duplicate buttons for assistive technology or for tests that query by role.
2. In `useLayoutEffect`, read the `offsetWidth` of each measured item (`item.getBoundingClientRect().width`, plus the separator width) once per `segments` change and cache them in a ref array.
3. A `ResizeObserver` on the visible container (`containerRef.current`) calls `recompute()` whenever its width changes. Also observe the hidden measuring list so web-font or label changes re-trigger. Disconnect on unmount.
4. `recompute()`: `available = container.clientWidth`. Start with `k = n - 3` (everything). While `sum(widths of pinned + kept + ellipsis if any) > available` and `k > 0`, decrement `k`. If even `k = 0` does not fit, keep `k = 0` (the pinned items then truncate through `max-width` and the container scrolls nothing: **no horizontal scroll** is allowed by §10, so the pinned text truncates).
5. Only call `setState` when `k` actually changed, to avoid render loops. Wrap the `ResizeObserver` callback in `requestAnimationFrame` to avoid the "ResizeObserver loop completed with undelivered notifications" warning.
6. When `ResizeObserver` is not defined (old environment, `jsdom`), fall back to computing once on mount and on `window` `resize`, and treat missing widths (all `0`) as "everything fits".
7. In `jsdom` all layout measurements are `0`, so measurement-driven collapse cannot be tested directly. The `maxVisibleOverride` prop makes `k = clamp(maxVisibleOverride, 0, n - 3)` and skips measurement entirely; tests use it. A second test group mocks `getBoundingClientRect`/`clientWidth` and a manual `ResizeObserver` stub to check the algorithm in step 4.

**Decision (not specified):** below `768px` (the `md` breakpoint) the spec says the breadcrumb "collapses aggressively" (§10). Measurement alone cannot do this, because it never hides Home or the last two segments. The `maxVisibleSegments` prop (previous section and next paragraph) is the single mechanism: the component itself contains no breakpoint logic, the caller (T035) passes `1` from a `matchMedia` subscription.

#### `maxVisibleSegments` layout

When `maxVisibleSegments` (m) is set and `n > m`:

1. Visible trail: the ellipsis button, then the last `m` segments (the final one is the `aria-current="page"` text). Home is **not** in the trail.
2. Hidden segments are `segments[0 .. n-m-1]` (Home first) and are the menu items in path order. The Home item's accessible name is "Home" and it calls `onNavigate('')`; `rootTitle` is set as its `title`.
3. No measurement is performed for the collapse decision (the hidden measuring list is not rendered); the last segment still truncates with `max-width` and an ellipsis so there is no horizontal overflow at 320 px.
4. When `n <= m` the standard rules apply (nothing to collapse). `maxVisibleOverride`, when also set, wins (test seam).

#### The overflow menu

The ellipsis button (its accessible name "Show hidden folders" is normative; T026 and its tests use exactly this string):

```tsx
<button type="button" aria-label="Show hidden folders" aria-haspopup="menu"
        aria-expanded={open} aria-controls={menuId}>…</button>
```

(the visible glyph is the lucide `Ellipsis` icon, `aria-hidden`, or the character `…`.)

When opened it reveals a popup:

```tsx
<ul role="menu" id={menuId} aria-label="Hidden folders">
  <li role="none"><button role="menuitem" type="button" tabIndex={-1}>Pictures</button></li>
  ...
</ul>
```

Positioning: `position: absolute; top: calc(100% + var(--space-1)); inset-inline-start: 0; z-index: 10; min-width: 10rem; max-width: min(20rem, calc(100vw - 2 * var(--page-gutter))); background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: var(--shadow-2); padding: var(--space-1)`. The wrapper `<li>` of the ellipsis is `position: relative`. Each menu item keeps `min-height: var(--target-min)`. **Decision (not specified):** no popover library and no portal; an absolutely positioned list inside the nav is enough, but the nav and its ancestors in the explorer header must not use `overflow: hidden`; note this for the E11 ticket in the Gotchas section.

Keyboard behaviour (the WAI-ARIA menu button pattern):

| Key | Behaviour |
|---|---|
| `Enter`, `Space`, `ArrowDown` on the ellipsis button | Open the menu and focus the **first** item. |
| `ArrowUp` on the ellipsis button | Open the menu and focus the **last** item. |
| `ArrowDown` / `ArrowUp` in the menu | Move focus to the next / previous item, wrapping at the ends. |
| `Home` / `End` in the menu | Focus first / last item. |
| `Enter` / `Space` on an item | Call `onNavigate(segment.path)`, close the menu. |
| `Escape` | Close the menu, **return focus to the ellipsis button**. |
| `Tab` / `Shift+Tab` | Close the menu without moving focus off its natural next stop. (Do not trap focus.) |
| Click outside, or focus moving outside | Close the menu (do not steal focus back in the click-outside case). |
| Typing a character | Optional: focus the next item beginning with that character. Not required. |

Details:

- Menu items use roving focus: only the focused item has `tabIndex={0}`, others `-1`, or all `-1` with programmatic `.focus()`; the menu itself is not tabbable.
- After a selection closes the menu, focus moves to the **ellipsis button** if it still exists after the navigation re-render; otherwise to the new last segment's container. Because navigation changes `path` and the explorer will re-render the trail, the simplest correct behaviour is: close the menu, call `onNavigate`, and let the ellipsis (if still present) keep focus via a ref. Do not leave focus on an unmounted element.
- Close the menu if the number of hidden segments becomes `0` (a resize made everything fit) or the `path` prop changes.
- Click outside is detected with a `pointerdown` listener on `document`, added only while open and removed on close/unmount.
- `aria-expanded` reflects state; `aria-controls` is present only while the menu is rendered.
- The menu must be rendered in the DOM only while open (so tests and assistive technology see no hidden menu).
- Each menu item's text is the segment `label`, with `title` for the full text.

Hover (guarded) states and focus rings follow section 4.2. The pinned and kept segment buttons use the `ghost` visual style (transparent resting background, `--fg`), the last segment uses `font-weight: 600` and `--fg`, and the separators use `--fg-muted`.

### 4.8 `Chip`

A small, non-interactive informational pill (for example the explorer's image-count chip "412 images") with an optional dismiss button.

```ts
export interface ChipProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children' | 'onClick'> {
  children: React.ReactNode;
  /** Optional leading decorative icon. */
  icon?: IconComponent;
  /** Visual tone. Default 'neutral'. */
  tone?: 'neutral' | 'accent';
  /**
   * When provided, a dismiss button is rendered. Its accessible name is
   * `${dismissLabel ?? 'Remove'}`; pass a specific label such as "Remove filter".
   */
  onDismiss?: () => void;
  dismissLabel?: string;           // default "Remove"
}
```

- A static chip is a `<span>` with no role and no tab stop; it is information, not a control. It must meet 4.5:1 text contrast.
- `neutral`: `background: var(--bg-sunken); color: var(--fg); border: 1px solid var(--border-subtle)`. `accent`: `background: var(--accent); color: var(--accent-fg)`.
- Geometry: `display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill); font-size: var(--text-sm); line-height: var(--leading-tight)`. A static chip is not a touch target (no interaction), so it is exempt from the 44 px minimum.
- With `onDismiss`: the dismiss `<button type="button" aria-label={dismissLabel ?? 'Remove'}>` containing an `X` icon is the interactive part and must provide the full 44 x 44 px target (48 on coarse) via padding or a `::before` hit area that extends outside the pill without changing its visible size, with `margin-inline-end: calc(var(--space-1) * -1)`. Focus ring uses the inset recipe so it is not clipped.
- The chip does not set `aria-live`. If the count changes asynchronously, the consumer (explorer) owns the live region.

### 4.9 `Banner`

An inline status notice for the explorer's truncation notice, the configuration screen's scan errors and the "restored folder no longer exists" notice. Called `Banner` in code; "Notice" is the user-facing concept.

```ts
export type BannerVariant = 'info' | 'warning' | 'error';

export interface BannerAction {
  /** Visible button text, e.g. "Retry". */
  label: string;
  onClick: () => void;
  /** Disables the button and shows a spinner, e.g. while a retry is in flight. */
  loading?: boolean;
}

export interface BannerProps
  extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children' | 'role' | 'title'> {
  variant?: BannerVariant;       // default 'info'
  /** Optional bold lead-in line. */
  title?: React.ReactNode;
  /** The message. Required. */
  children: React.ReactNode;
  /** Optional single action button, e.g. { label: 'Retry', onClick }. */
  action?: BannerAction;
  /** Optional dismiss. When provided a close IconButton named "Dismiss" is rendered. */
  onDismiss?: () => void;
}
```

**Decision (not specified): live-region semantics.**

- All variants render `aria-live="polite"` on the banner element, which satisfies NFR-6 ("`aria-live="polite"` for async errors and counts").
- The `error` variant **additionally** carries `role="alert"`. `role="alert"` implies `aria-live="assertive"`, but NFR-6 requires `aria-live="polite"` for async errors. An error banner therefore renders **both** `role="alert"` and an explicit `aria-live="polite"`. The explicit attribute overrides the role's implicit assertive value in current browsers and screen readers, so the announcement is polite while the node is still exposed with the alert role that screen-reader users look for.
- `info` and `warning` render `role="status"` with `aria-live="polite"` (`role="status"` is implicitly polite; the explicit attribute is redundant but harmless and keeps the test assertion uniform).
- `aria-atomic="true"` on all variants so the whole message is read, not a diff.
- **A live region must exist before its content changes.** Consumers conditionally render the banner as the status changes; many screen readers only announce changes inside a region that was already in the DOM. Document this in the component's doc comment: for reliable announcements, keep a `Banner`'s wrapper mounted and change its children, or render it with new content (modern screen readers announce a newly inserted `role="alert"` reliably, which is the reason errors carry that role while `info` relies on being kept mounted). The gallery shows both. **Consumers must not wrap a `Banner` in another `role="status"` / `aria-live` container**: the banner is its own live region, and nested live regions announce twice or not at all (T029 renders the player notice as a bare error `Banner`).

Layout and visuals:

- A flex row: leading `Icon` (decorative), text block (`title` in `font-weight: 600`, then children), then the action button, then the dismiss button. Wraps on narrow screens (`flex-wrap: wrap`), action beneath the text below `480px`.
- Variants by token, with a left accent bar (`border-inline-start: 4px solid`) so the type is not conveyed by colour alone; each variant also has its own icon (`Info`, `TriangleAlert`, `CircleAlert`):
  - `info`: `background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-inline-start-color: var(--accent); color: var(--fg)`.
  - `warning`: same surface as `info`. T020 defines no warning colour token, so **Decision (not specified):** warning reuses `--accent` for the bar, with the `TriangleAlert` icon and a visually hidden prefix (`<span class="sr-only">Warning: </span>`), instead of introducing a new colour token. A new token would require changing T020's contrast test; the icon, bar and screen-reader prefix distinguish it adequately.
  - `error`: `border-inline-start-color: var(--danger)`; icon colour `var(--danger)` (4.5:1 on `--bg-elevated` in both themes, verified by the T020 pairs for `--bg`; `--bg-elevated` is within 0.2 of the same luminance, re-check manually). A visually hidden "Error: " prefix is likewise provided. `info` gets a hidden "Note: " prefix.
- Text always uses `var(--fg)` on `var(--bg-elevated)` (15 to 16:1); only the bar and icon carry the variant colour.
- The action is a `Button` with `variant="secondary"` and `size="md"`; the dismiss control is an `IconButton` with `icon={X}`, `aria-label="Dismiss"`, `variant="ghost"`.
- Padding `var(--space-3) var(--space-4)`, `border-radius: var(--radius-md)`.

### 4.10 `Spinner`

```ts
export interface SpinnerProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'children'> {
  /** CSS length, e.g. "1.25rem" or "1em". Default "1.25rem". */
  size?: string;
  /**
   * Accessible name. When provided the spinner is exposed as role="status"
   * with this text; when omitted it is decorative (aria-hidden) and the
   * surrounding UI must announce the busy state itself.
   */
  label?: string;
}
```

- An inline SVG circle with a partial arc (`stroke: currentColor`, `stroke-linecap: round`, `stroke-dasharray`), rotated by a CSS `@keyframes spin` (`transform: rotate(360deg)`, `1s linear infinite`). Colour is `currentColor` so it follows context (accent on a primary button, `--fg-muted` standalone).
- With `label`: wrap in `<span role="status">` containing the SVG (`aria-hidden`) and `<span class="sr-only">{label}</span>`. Without `label`: the SVG is `aria-hidden="true"`, `focusable="false"`.
- **Reduced motion.** The global T020 rule sets `animation-duration: 0.01ms !important`, which would freeze the spinner and make "busy" invisible. Override inside `Spinner.module.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .svg { animation-duration: 2.4s !important; animation-iteration-count: infinite !important; }
}
```

  A slow rotation is a permitted exception because the essential information (activity is happening) cannot otherwise be conveyed without motion, and WCAG 2.3.3 targets motion-triggered by interaction. This is the one place the global safety net is intentionally overridden.
- Animates `transform` only.

### 4.11 `Skeleton`

A placeholder block shown while content loads (explorer rows, thumbnail tiles).

```ts
export interface SkeletonProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> {
  /** CSS width, default "100%". */
  width?: string;
  /** CSS height, default "1em". */
  height?: string;
  /** Shape. Default 'rect'. 'circle' forces equal width and height from `height`. */
  shape?: 'rect' | 'circle' | 'text';
  /** Number of stacked lines for shape 'text'. Default 1. */
  lines?: number;
}
```

- Decorative: `aria-hidden="true"`, no role, no text. The container that owns the loading state announces it (for example with `aria-busy="true"` on the list and a polite status "Loading").
- Background `var(--bg-sunken)`, radius `var(--radius-sm)` (`circle` uses `--radius-pill`). The shimmer is a gradient moving across the block, animating `transform` of a `::after` layer from `translateX(-100%)` to `translateX(100%)` over `1.4s` using the colours `transparent`, `var(--bg-elevated)`, `transparent`. Under `prefers-reduced-motion: reduce` the shimmer is **removed** (static block, `animation: none`), since decorative motion is not essential.
- `width`/`height` are applied as inline `style`, the second permitted inline-style use (lengths only, no colours).
- Use `display: block`; `shape="text"` renders `lines` stacked blocks with `gap: var(--space-2)` and the final line at 60 % width.

### 4.12 Interaction with the rest of the app (conventions to state in doc comments)

- `Button` and `IconButton` carry no navigation semantics; links to external resources do not exist in v1.
- `Checkbox` and `Slider` are controlled-only so that the configuration screen's single source of truth (`AppState.config`) always drives them. The configuration screen uses these two components directly; it does not build its own checkbox row or slider.
- The Player controls pill (T033+) will compose `IconButton` with `variant="ghost"` on an `--overlay-bg` surface. Make sure `ghost` text and icon colours are inheritable from a parent by using `color: inherit` as a documented override path: when a parent sets `color: var(--overlay-fg)` and passes `className`, a ghost button must pick it up. Therefore the `ghost` variant uses `color: var(--button-fg, var(--fg))`, with the custom property `--button-fg` as the documented extension point. The same pattern applies to `--button-hover-bg`. Consumers set these custom properties to token values; they never set raw colours.

### 4.13 Dev-only component gallery

**Decision (not specified): include a gallery page, reachable only in development, at `client/src/components/gallery/Gallery.tsx`.**

- It renders every component in every variant and state (disabled, loading, pressed, checked and unchecked checkboxes with and without a description or note, long labels, 1/2/3/6/12-segment breadcrumbs, each banner variant with and without an action), plus a button to flip the theme attribute so both themes can be checked without the T021 toggle, and a width slider (a plain `div` with `style={{ width }}` and `resize: horizontal`) so the breadcrumb collapse can be exercised.
- It is mounted from `client/src/main.tsx` (T019's file, which imports the default `App`) **only** when `import.meta.env.DEV` is true **and** `location.hash === '#/gallery'`, using a dynamic import so it is excluded from the production bundle:

```tsx
if (import.meta.env.DEV && location.hash === '#/gallery') {
  const { Gallery } = await import('./components/gallery/Gallery');
  root.render(<StrictMode><Gallery /></StrictMode>);
} else {
  root.render(<StrictMode><App /></StrictMode>);
}
```

  (Use a small async bootstrap function rather than top-level `await` if the Vite target does not allow it.) Vite replaces `import.meta.env.DEV` with `false` in production builds and removes the branch, and the dynamic import is dropped with it. Verify by checking that `npm run build --workspace @slydr/client` writes no file under `client/dist/assets/` whose content contains the unique marker string `slydr-component-gallery`, which the gallery root element carries as its `data-gallery` attribute value (a plain search for the word "Gallery" is not reliable: bundled dependencies can contain it).
- The specification has no deep-linking requirement (A2); a hash is used only for this dev tool and does not appear in the real app. It is not exported from the barrel.
- The gallery has no tests beyond a smoke test that it renders without throwing and contains one instance of each exported component.
- The gallery root element carries `data-gallery="slydr-component-gallery"`; that string is the marker the production-build check searches for.

## 5. Acceptance criteria

- [ ] All ten components exist at the paths in section 4.1, each with a `.tsx`, `.module.css` and `index.ts`, and each has a `client/test/components/<Component>.test.tsx`; `components/index.ts` exports every component and prop type listed in section 4.1 (`Button`, `IconButton`, `Checkbox`, `Slider`, `Icon`, `Breadcrumb`, `Chip`, `Banner`, `Skeleton`, `Spinner`). No file under `client/src/components/` is a test file. There is no `Toggle` component and no `role="switch"` anywhere in the library.
- [ ] No component CSS contains a hex, `rgb()`, `hsl()` or named colour; the T020 no-hard-coded-colours test passes with the new files included.
- [ ] Every `:hover` rule in the new CSS is inside `@media (hover: hover)`; a grep for `:hover` outside such a block returns nothing.
- [ ] No new CSS contains `outline: none` or `outline: 0` (other than inside `:focus:not(:focus-visible)`); every interactive component shows a visible ring on keyboard focus, drawn from `--focus-ring`.
- [ ] Every interactive element has `min-height` and `min-width` of `var(--target-min)`, raised to `var(--target-min-coarse)` under `@media (pointer: coarse)`.
- [ ] `<Button iconOnly icon={X} />` without `aria-label` is a TypeScript error (`@ts-expect-error` test compiles under `tsc --noEmit`); `<IconButton icon={X} />` without `aria-label` is also a type error; `<Button iconOnly icon={X} aria-label="Close" />` compiles.
- [ ] `Button` defaults to `type="button"`; `loading` sets `aria-busy="true"` and suppresses `onClick` without removing focusability.
- [ ] `Checkbox` renders a native `input[type=checkbox]` **without** a `role` attribute, an associated visible label, and `aria-describedby` pointing at its description and/or note when provided (the note is outside the label, so it is not part of the accessible name); `Space` toggles it; there is no `aria-checked` attribute on it; its tick/box is drawn from tokens.
- [ ] `Slider` renders `input[type=range]` with `aria-valuetext` equal to `(formatValueText ?? formatValue)(value)`, a visible `<output aria-live="off">` showing `formatValue(value)`, `ArrowRight`/`ArrowUp` raising the value by `step` (1) and `ArrowLeft`/`ArrowDown` lowering it, and `PageUp`/`PageDown` changing it by exactly `pageStep` (5), clamped to `[min, max]`, with the native event default-prevented.
- [ ] `Icon` is `aria-hidden="true"` by default and exposes `role="img"` with `aria-label` only when `label` is passed.
- [ ] `Breadcrumb` with `breadcrumbSegments(path).length <= 3` shows every segment and no ellipsis; with more segments, and a limited width, it shows Home, an ellipsis button named "Show hidden folders", and the last two segments; the menu lists the hidden segments in path order; `Escape` closes it and returns focus to the ellipsis button; `ArrowDown`/`ArrowUp` move between items with wrap; choosing an item calls `onNavigate` with that segment's wire path. With `maxVisibleSegments={1}` the trail shows only the ellipsis button and the current segment, and the menu lists Home first, then the other segments in path order.
- [ ] The current (last) breadcrumb segment is not a button and carries `aria-current="page"`.
- [ ] `Breadcrumb` with `rootTitle="C:\\Users\\Me"` sets that string as the `title` of the Home segment while its accessible name stays "Home".
- [ ] `Banner` has `aria-live="polite"` on every variant, `role="alert"` on `error`, `role="status"` on `info` and `warning`, and an action button with the given label that fires `onClick`.
- [ ] `Spinner` and `Skeleton` are `aria-hidden` unless a `label` is given (Spinner only); `Skeleton` shimmer and Spinner speed respond to `prefers-reduced-motion` as described.
- [ ] Gallery is excluded from the production build: no file in `client/dist/assets/` contains the marker `slydr-component-gallery`.
- [ ] Both themes verified manually through the gallery; text pairs used by the components are among those asserted by T020 (`--fg` on `--bg`/`--bg-elevated`/`--bg-sunken`, `--fg-muted` on `--bg`, `--accent-fg` on `--accent`, `--danger` on `--bg`).

## 6. Tests to write

Per specification §12.3 (component tests with React Testing Library) and NFR-6. Use `@testing-library/user-event` (`userEvent.setup()`) for keyboard and pointer interaction. Tests live under `client/test/components/` (one `<Component>.test.tsx` per component, mirroring `src/components/`; Vitest only discovers `client/test/**`) and import `describe`, `it`, `expect`, `vi` from `'vitest'`. All tests render with `render(...)` from `@testing-library/react`; none depends on a particular theme. Component imports use the barrel or the component folder (`../../src/components/Button`).

### `client/test/components/Button.test.tsx`

1. `renders a native button with its label and type="button" by default`.
2. `calls onClick once when clicked, and not when disabled`.
3. `loading sets aria-busy, ignores clicks, and stays focusable`.
4. `renders each variant class` — `primary`, `secondary`, `ghost` produce distinct class names (assert `className` contains the module class for the variant).
5. `icon-only button exposes its aria-label as the accessible name` — `getByRole('button', { name: 'Close' })`.
6. `type-level: icon-only button requires aria-label` — a `describe`-level block of `// @ts-expect-error` lines: `<Button iconOnly icon={X} />`, `<Button iconOnly icon={X} aria-label="" children="x" />` (children forbidden), and a valid `<Button iconOnly icon={X} aria-label="Close" />` that must compile. The test body just renders the valid case; `npm run typecheck` is what proves the expectations (an unused `@ts-expect-error` is itself a compile error). Include the test file in the client `tsconfig` `include` so it is type-checked.
7. `forwards ref and merges className`.

### `IconButton.test.tsx`

8. `has the accessible name from aria-label and a matching title`.
9. `pressed maps to aria-pressed and omits it when undefined`.
10. `type-level: aria-label is required` (`@ts-expect-error` on a missing label).
11. `logs a dev error for an empty aria-label at runtime` (spy on `console.error`; cast to bypass the types).

### `Checkbox.test.tsx`

12. `exposes the checkbox role and the label as accessible name` — `getByRole('checkbox', { name: 'Shuffle images' })`; `queryByRole('switch')` is `null` and the input has no `role` attribute.
13. `reflects checked state and fires onCheckedChange with the new value` (click and `Space`).
14. `clicking the label text toggles it`.
15. `links the description and the note with aria-describedby, and keeps the note out of the accessible name`.
16. `does not set aria-checked`, and `disabled` blocks changes.
17. `remains in the tab order` — `await user.tab()` focuses the input.

### `Slider.test.tsx`

18. `renders range input, label and an output with formatted value` — value 5 with `formatValue={(v) => `${v} s`}` and `formatValueText={(v) => `${v} seconds`}` shows "5 s" in the `output` (which has `aria-live="off"`) and `aria-valuetext="5 seconds"`; without `formatValueText` the `aria-valuetext` is "5 s".
19. `change events map to onValueChange with a number` — `jsdom` does not implement native arrow-key stepping on range inputs, and production code must not gain test-only branches. Simulate the browser's result with `fireEvent.change(input, { target: { value: '6' } })` and assert `onValueChange(6)` (a number, not the string). Native arrow stepping is the browser's job and is covered by the manual and end-to-end checks.
20. `PageUp adds 5 and PageDown subtracts 5` — with value 5, `fireEvent.keyDown(input, { key: 'PageUp' })` produces `onValueChange(10)`; with value 3 (min 1), `{ key: 'PageDown' }` produces `onValueChange(1)` (clamped to `min`). In both cases `fireEvent.keyDown` returns `false`, proving `preventDefault` was called.
21. `PageUp clamps at max and does not call onValueChange when already at max`.
22. `ignores PageUp when a modifier is held` (`ctrlKey: true`).
23. `custom pageStep` — `pageStep={10}`.
24. `clamps out-of-range and non-finite values for display`.
25. `sets the --slider-fill custom property proportional to the value`.

### `Icon.test.tsx`

26. `is aria-hidden and not focusable by default`.
27. `with label exposes role="img" and aria-label and drops aria-hidden`.
28. `forwards size and className`.

### `Breadcrumb.test.tsx`

(Add to the cases below: `rootTitle` is applied as the Home segment's `title` without changing its accessible name "Home".)

29. `renders Home and every segment as a list of buttons, with the last as aria-current="page" text` — path `Pictures/2024` yields buttons `Home`, `Pictures` and a non-button `2024` with `aria-current="page"`.
30. `root path renders only Home as the current item` (`path=""`: `Home` is `aria-current`, not a button).
31. `clicking a segment calls onNavigate with its wire path` — click `Pictures`: `onNavigate('Pictures')`; click Home: `onNavigate('')`.
32. `three or fewer segments never collapse` — `maxVisibleOverride={0}` still shows all three.
33. `collapses the middle: Home, ellipsis, last two` — path `a/b/c/d/e` (6 segments) with `maxVisibleOverride={0}`: visible buttons are `Home`, `Show hidden folders`, `d` (button), and `e` is `aria-current`; `a`, `b` and `c` are not in the document until the menu opens.
34. `keeps the deepest middle segments when some fit` — `maxVisibleOverride={1}`: `c` is visible, `a` and `b` are in the menu.
35. `ellipsis menu lists hidden segments in path order` — open it, assert `menuitem` names `a`, `b`, `c` in order.
36. `menu keyboard: Enter/ArrowDown opens and focuses the first item; ArrowUp opens and focuses the last`.
37. `arrow keys move and wrap; Home and End jump`.
38. `Escape closes the menu and returns focus to the ellipsis button`.
39. `selecting an item calls onNavigate with that segment's path and closes the menu`.
40. `click outside closes the menu`.
41. `aria-expanded and aria-haspopup are set correctly`.
42. `measurement: recomputes when the container resizes` — stub `ResizeObserver` with a manual trigger, mock widths (each segment 100 px, container 350 px); expect Home + ellipsis + the last two to fit and `k = 0`, then widen the container to 1000 px, trigger the stub, and assert all segments render with no ellipsis.
43. `does not render the measuring list in the accessibility tree` — `queryAllByRole('button', { name: 'Home' })` has length 1.
44. `long labels truncate and expose the full text in title`.
44a. `maxVisibleSegments=1 shows only the ellipsis button and the current segment` — path `a/b/c`: buttons are `Show hidden folders` only (plus the non-button `c` with `aria-current="page"`); `Home`, `a` and `b` are not in the trail.
44b. `maxVisibleSegments=1 lists Home first in the overflow menu` — open it: `menuitem` names are `Home`, `a`, `b` in that order; choosing `Home` calls `onNavigate('')`, choosing `b` calls `onNavigate('a/b')`.
44c. `maxVisibleSegments=2 keeps the last two segments and hides the rest` — path `a/b/c/d`: trail is the ellipsis button, `c` (button), `d` (current); menu: `Home`, `a`, `b`.
44d. `maxVisibleSegments is ignored when the path has no more segments than the cap` — root path with `maxVisibleSegments=1` renders Home as the current item and no ellipsis.
44e. `maxVisibleSegments undefined keeps the standard layout` — same as test 33.

### `Chip.test.tsx`

45. `renders its content without a role or tab stop`.
46. `renders a dismiss button named by dismissLabel and fires onDismiss`.
47. `default dismiss name is "Remove"`.

### `Banner.test.tsx`

48. `error variant has role="alert" and aria-live="polite"`.
49. `info and warning variants have role="status" and aria-live="polite"`.
50. `all variants set aria-atomic="true"`.
51. `renders title and message and a visually hidden variant prefix`.
52. `action button has the given label and fires onClick`; `loading` action is disabled-looking and does not fire.
53. `dismiss button is named "Dismiss" and fires onDismiss`.
54. `live region announces newly inserted content` — render with `rerender` toggling a child message, assert the container with `aria-live` persists (same DOM node) while its text changes.

### `Spinner.test.tsx` and `Skeleton.test.tsx`

55. `Spinner is aria-hidden without a label`.
56. `Spinner with label renders role="status" and the label text`.
57. `Skeleton is aria-hidden and applies width and height`.
58. `Skeleton shape="text" renders the requested number of lines`.

### Cross-cutting and gallery

59. `barrel exports` (`client/test/components/barrel.test.ts`) — `import * as components from '../../src/components'` exposes exactly the ten component names (`Object.keys` sorted equals `['Banner','Breadcrumb','Button','Checkbox','Chip','Icon','IconButton','Skeleton','Slider','Spinner']`).
60. `gallery smoke test` (`client/test/components/Gallery.test.tsx`) — renders without throwing and contains a button, a checkbox, a slider, a navigation landmark, a status and an alert, and the root carries `data-gallery="slydr-component-gallery"`.
61. `no component source contains a colour literal` — covered by the T020 test; add the new directory to its glob if it is path-restricted.
62. `Checkbox` and the library contain no `role="switch"` (a source scan of `client/src/components/**` finds no `switch` role string).

### Manual verification (recorded in the pull request)

In the gallery, in both themes and at 320 px and 1920 px: tab through every control and confirm a visible focus ring; confirm disabled and loading states; verify touch-target sizes with the browser's device emulation and `pointer: coarse`; operate the Slider with the keyboard in Chrome, Firefox and Safari/WebKit (native arrows plus the PageUp/PageDown handler); drive the Breadcrumb narrower and wider and confirm Home plus the last two segments never disappear; screen-reader smoke test of Checkbox, Slider and Banner with NVDA or VoiceOver where available (the checkbox is announced as a checkbox, not as a switch).

## 7. Definition of done

- [ ] `npm run typecheck` passes with no new errors, including the intentional `@ts-expect-error` type-level tests.
- [ ] `npm run lint` passes with no new errors.
- [ ] New logic covered by unit tests; `npm test` green.
- [ ] All items in section 5 verified; the T020 no-hard-coded-colours test still passes.
- [ ] Both themes checked in the gallery; verified at 320 px and 1920 px with no horizontal page scroll.
- [ ] `npm run build --workspace @slydr/client` succeeds; the gallery is absent from `client/dist` (marker check of section 4.13); gzipped bundle remains well under the 300 KB NFR-8 budget (only used `lucide-react` icons are included).
- [ ] Every item labelled **Decision (not specified)** in section 4 appears as a short comment at the relevant line in the code.
- [ ] Each component file has a short doc comment stating its accessibility contract.
- [ ] README: no change here; T041 creates the README and carries a short developer note on the component library (tokens-only and touch-target rules, `#/gallery` under `npm run dev`).

## 8. Notes and gotchas

- **`aria-label` enforcement is a type-level guarantee, not a runtime one.** The discriminated union in `Button` and the required prop in `IconButton` make the mistake a compile error. The dev-only `console.error` catches the JavaScript and `any` escape hatches. Do not "fix" a type error by passing an empty string; the test for that is intentional.
- **Native range and `PageUp`/`PageDown`.** Browsers give `PageUp`/`PageDown` a large, browser-specific step (often 10 % of the range) and in some browsers they do nothing on a range input. Specification §8.2 requires exactly +-5, so the custom handler with `preventDefault` is required, and arrow keys deliberately stay native. Do not intercept the arrow keys: native behaviour respects text direction and screen-reader virtual cursor handoff.
- **`jsdom` has no layout.** Every `getBoundingClientRect` and `clientWidth` returns `0`, and `ResizeObserver` does not exist. The `maxVisibleOverride` seam and the stubbed observer in tests exist for this reason. Keep `maxVisibleOverride` out of production call sites.
- **ResizeObserver loop warnings.** Updating state inside an observer callback that changes the observed element's size produces "ResizeObserver loop completed with undelivered notifications". Defer the state update with `requestAnimationFrame` and only set state when the computed `k` changes.
- **Hidden measuring clones must be `aria-hidden` and `inert`.** Otherwise a screen reader reads the trail twice and `getByRole` finds duplicate buttons. Use `visibility: hidden` in addition so the clone cannot receive focus in browsers lacking `inert` support.
- **Do not clip the overflow menu.** The breadcrumb menu is absolutely positioned and will be cut off by any ancestor with `overflow: hidden`. The explorer header (E11) must not apply `overflow: hidden` to the breadcrumb container; truncation is done on individual labels with `max-width` instead.
- **`:focus-visible` plus hidden inputs.** For `Checkbox`, the focus ring must be on the visible box via the sibling selector. A ring drawn on the hidden 1 px input is invisible and fails NFR-6.
- **Live regions need to exist first.** `aria-live` and `role="status"` announce changes to content inside a region already in the DOM; inserting a fresh region with its text is announced inconsistently except for `role="alert"`. Screens (E10 to E14) should keep one `Banner` mounted per status area where practical, or accept that `error` banners announce on insertion.
- **`role="alert"` plus `aria-live="polite"`.** The alert role implies assertive. The specification (NFR-6) says async errors are polite. The component sets both so that the announcement is polite while the node remains exposed with the alert role. If a later accessibility pass (E21) finds this combination announced inconsistently by a target screen reader, the fallback is dropping the explicit `aria-live` and keeping `role="alert"`; change it in one place (`Banner.tsx`) and update test 48.
- **Cross-platform rendering.** Slider pseudo-elements differ between WebKit and Gecko; always write the `::-webkit-slider-*` and `::-moz-range-*` rules as separate rule sets. On Windows high-contrast mode (`forced-colors`) custom track colours are overridden; add `@media (forced-colors: active)` rules in `Checkbox`, `Slider` and `Banner` that fall back to system colours (`CanvasText`, `Highlight`, `ButtonText`). These are system colour keywords, not authored colours, but the T020 literal-colour guard matches only hex and functional notation, so they pass; add a one-line allowed-exception comment.
- **Hover-only affordances.** Nothing in this library may rely on hover to reveal content or controls. The Chip dismiss button, the Banner dismiss button and the Breadcrumb menu are always reachable by tap and keyboard.
- **Do not widen the library.** No `Modal`, `Tooltip`, `Select`, `Menu` or `Tabs` components are in this ticket. If a later ticket needs one, it adds it deliberately rather than growing this one.
- **Specification §6.3 and §9.2.** The theme toggle (T021) and the player controls pill (T033+) compose these components; neither is built here. The player's pill relies on the `--button-fg` and `--button-hover-bg` extension points defined in section 4.12.

