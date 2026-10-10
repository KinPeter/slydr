import { Folder, Image, Play, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '../Banner/Banner';
import { Breadcrumb } from '../Breadcrumb/Breadcrumb';
import { Button } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { Chip } from '../Chip/Chip';
import { IconButton } from '../IconButton/IconButton';
import { Skeleton } from '../Skeleton/Skeleton';
import { Slider } from '../Slider/Slider';
import { Spinner } from '../Spinner/Spinner';
import styles from './Gallery.module.css';

/**
 * Dev-only component gallery (reachable under `npm run dev` at `#/gallery`).
 * Renders every library component in every variant and state for manual
 * verification in both themes and at 320px / 1920px. Excluded from the
 * production bundle via a dynamic import in `main.tsx`; the root carries
 * `data-gallery="slydr-component-gallery"` as the build-exclusion marker.
 */
export function Gallery() {
  const [checked, setChecked] = useState(true);
  const [seconds, setSeconds] = useState(5);
  const [width, setWidth] = useState(480);
  const [themeFlip, setThemeFlip] = useState(0);

  function flipTheme(): void {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    setThemeFlip((n) => n + 1);
  }

  return (
    <main className={styles.gallery} data-gallery="slydr-component-gallery">
      <h1>Slydr component gallery</h1>
      <p data-testid="theme-flip-count" hidden>
        {themeFlip}
      </p>
      <Button variant="secondary" size="md" onClick={flipTheme}>
        Flip theme attribute
      </Button>

      <section aria-label="Buttons" className={styles.section}>
        <h2>Buttons</h2>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="secondary" icon={Plus}>
            With icon
          </Button>
          <Button iconOnly icon={X} aria-label="Close dialog" />
          <IconButton icon={X} aria-label="Close dialog" />
          <IconButton icon={Play} aria-label="Play" pressed />
        </div>
      </section>

      <section aria-label="Checkbox" className={styles.section}>
        <h2>Checkbox</h2>
        <Checkbox label="Shuffle images" checked={checked} onCheckedChange={setChecked} />
        <Checkbox
          label="Loop slide show"
          description="Start again when all images were shown"
          checked={false}
          onCheckedChange={() => undefined}
        />
        <Checkbox
          label="Use animations and transitions"
          description="Slow zoom and crossfade"
          note="Reduced motion is on: slides swap instantly."
          checked
          onCheckedChange={() => undefined}
        />
        <Checkbox
          label="Disabled option"
          checked={false}
          onCheckedChange={() => undefined}
          disabled
        />
      </section>

      <section aria-label="Slider" className={styles.section}>
        <h2>Slider</h2>
        <Slider
          label="Duration for image shown"
          value={seconds}
          onValueChange={setSeconds}
          min={1}
          max={30}
          formatValue={(v) => `${v} s`}
          formatValueText={(v) => `${v} seconds`}
        />
      </section>

      <section aria-label="Breadcrumb" className={styles.section}>
        <h2>Breadcrumb</h2>
        <label className={styles.widthLabel}>
          Trail width: {width}px
          <input
            type="range"
            aria-label="Trail width"
            min={200}
            max={900}
            step={10}
            value={width}
            onChange={(event) => setWidth(Number(event.currentTarget.value))}
          />
        </label>
        <div className={styles.trailBox} style={{ width: `${width}px` }}>
          <Breadcrumb path="Pictures" onNavigate={() => undefined} />
          <Breadcrumb path="Pictures/2024" onNavigate={() => undefined} />
          <Breadcrumb path="a/b/c" onNavigate={() => undefined} />
          <Breadcrumb path="a/b/c/d/e" onNavigate={() => undefined} />
          <Breadcrumb
            path="Pictures/2024/summer/beach/sunset/20240801/edited/final/best/shortlist"
            onNavigate={() => undefined}
          />
          <Breadcrumb path="a/b/c" onNavigate={() => undefined} maxVisibleSegments={1} />
        </div>
      </section>

      <section aria-label="Chips" className={styles.section}>
        <h2>Chips</h2>
        <div className={styles.row}>
          <Chip>412 images</Chip>
          <Chip tone="accent" icon={Image}>
            Featured
          </Chip>
          <Chip onDismiss={() => undefined} dismissLabel="Remove filter">
            Filtered
          </Chip>
          <Chip icon={Folder} onDismiss={() => undefined}>
            Folder
          </Chip>
        </div>
      </section>

      <section aria-label="Banners" className={styles.section}>
        <h2>Banners</h2>
        <Banner variant="info" title="Scanning">
          N images found.
        </Banner>
        <Banner variant="warning" action={{ label: 'Retry', onClick: () => undefined }}>
          Showing a partial listing.
        </Banner>
        <Banner
          variant="error"
          title="Scan failed"
          action={{ label: 'Retry', onClick: () => undefined }}
          onDismiss={() => undefined}
        >
          The folder could not be read.
        </Banner>
        <Banner
          variant="error"
          action={{ label: 'Retrying', loading: true, onClick: () => undefined }}
          onDismiss={() => undefined}
        >
          Retry in flight.
        </Banner>
      </section>

      <section aria-label="Loading placeholders" className={styles.section}>
        <h2>Loading placeholders</h2>
        <div className={styles.row}>
          <Spinner />
          <Spinner label="Loading images" />
        </div>
        <Skeleton width="100%" height="2.75rem" />
        <Skeleton shape="circle" height="2.5rem" />
        <Skeleton shape="text" lines={3} />
      </section>
    </main>
  );
}
