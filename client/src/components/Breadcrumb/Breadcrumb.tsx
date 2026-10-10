import { breadcrumbSegments } from '@slydr/shared';
import { ChevronRight, Ellipsis, Home } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type React from 'react';
import { cx } from '../../lib/cx';
import { Icon } from '../Icon/Icon';
import { useBreadcrumbLayout } from './useBreadcrumbLayout';
import styles from './Breadcrumb.module.css';

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

interface TrailSegment {
  label: string;
  path: string;
}

type TrailNode = { kind: 'segment'; segment: TrailSegment } | { kind: 'ellipsis' };

/**
 * Path trail for the explorer header (spec §7.3).
 *
 * Accessibility contract: a `<nav>` landmark containing an `<ol>`; every level
 * except the current one is a real `<button>`, separators are decorative and
 * silent, and the current folder is a non-interactive `<span
 * aria-current="page">`. Decision (not specified): the current folder is not a
 * button — navigating to the folder you are already in would only add a
 * pointless tab stop. The overflow menu follows the WAI-ARIA menu-button
 * pattern (arrow/Home/End roving focus, `Escape` returns focus, `Tab` closes
 * without trapping). Decision (not specified): the menu is absolutely
 * positioned inside the nav with no portal or popover library, so no ancestor
 * of the breadcrumb may use `overflow: hidden` or the menu will be clipped.
 */
export function Breadcrumb({
  path,
  onNavigate,
  rootTitle,
  'aria-label': ariaLabel = 'Breadcrumb',
  className,
  maxVisibleOverride,
  maxVisibleSegments,
}: BreadcrumbProps) {
  const segments: TrailSegment[] = breadcrumbSegments(path);
  const count = segments.length;
  const home = segments[0];
  const last = segments[count - 1];
  const cap =
    maxVisibleSegments === undefined ? undefined : Math.max(1, Math.floor(maxVisibleSegments));
  const overrideWins = maxVisibleOverride !== undefined;
  // Decision (not specified): below 768px the breadcrumb "collapses aggressively"
  // (spec §10). Measurement alone cannot do that, so `maxVisibleSegments` is the
  // single mechanism and this component contains no breakpoint logic itself.
  const capped = !overrideWins && cap !== undefined && count > cap;

  const { containerRef, measureRef, visibleMiddle } = useBreadcrumbLayout(
    count,
    [path],
    maxVisibleOverride,
  );

  const maxMiddle = Math.max(0, count - 3);
  const keptMiddleCount = Math.min(Math.max(visibleMiddle, 0), maxMiddle);
  const middle = segments.slice(1, Math.max(1, count - 2));
  const keptMiddle =
    keptMiddleCount > 0 ? middle.slice(Math.max(0, middle.length - keptMiddleCount)) : [];
  const hiddenStandard = middle.slice(0, Math.max(0, middle.length - keptMiddleCount));

  let trail: TrailNode[];
  let hidden: TrailSegment[];
  if (home === undefined || last === undefined) {
    // `breadcrumbSegments` always returns at least the Home entry; this only
    // narrows the types for `noUncheckedIndexedAccess`.
    trail = [];
    hidden = [];
  } else if (capped) {
    trail = [
      { kind: 'ellipsis' },
      ...segments
        .slice(count - (cap ?? count))
        .map((segment) => ({ kind: 'segment' as const, segment })),
    ];
    hidden = segments.slice(0, count - (cap ?? count));
  } else if (count <= 3) {
    trail = segments.map((segment) => ({ kind: 'segment' as const, segment }));
    hidden = [];
  } else {
    const pinned = segments.slice(count - 2);
    trail = [
      { kind: 'segment', segment: home },
      ...(hiddenStandard.length > 0 ? [{ kind: 'ellipsis' as const }] : []),
      ...keptMiddle.map((segment) => ({ kind: 'segment' as const, segment })),
      ...pinned.map((segment) => ({ kind: 'segment' as const, segment })),
    ];
    hidden = hiddenStandard;
  }

  const menuId = useId();
  const navRef = useRef<HTMLElement | null>(null);
  const ellipsisRef = useRef<HTMLButtonElement | null>(null);
  // Focus fallback for menu selection when navigation removes the ellipsis:
  // the re-rendered current (last) segment. It carries tabIndex={-1} so it is
  // programmatically focusable without entering the tab order.
  const currentRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const pendingFocusRef = useRef<'first' | 'last' | null>(null);
  const [open, setOpen] = useState(false);

  // Close the menu when navigation changes the trail under it.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Close the menu if a resize made everything fit.
  useEffect(() => {
    if (open && hidden.length === 0) setOpen(false);
  }, [open, hidden.length]);

  // Focus the requested item once the menu is in the DOM.
  useEffect(() => {
    if (!open || pendingFocusRef.current === null) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const wanted = pendingFocusRef.current;
    pendingFocusRef.current = null;
    const target = wanted === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [open]);

  // Click outside closes the menu without stealing focus.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (
        navRef.current &&
        event.target instanceof Node &&
        !navRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function openMenu(focus: 'first' | 'last'): void {
    pendingFocusRef.current = focus;
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean): void {
    pendingFocusRef.current = null;
    setOpen(false);
    if (returnFocus) ellipsisRef.current?.focus();
  }

  function choose(segment: TrailSegment): void {
    pendingFocusRef.current = null;
    setOpen(false);
    onNavigate(segment.path);
    // Let the re-rendered trail settle, then keep focus on the ellipsis button
    // when it still exists instead of stranding focus on an unmounted node.
    // When navigation shrank the trail to <= 3 segments the ellipsis is gone:
    // fall back to the new current segment rather than leaving focus on body.
    window.setTimeout(() => {
      if (ellipsisRef.current) {
        ellipsisRef.current.focus();
      } else {
        currentRef.current?.focus();
      }
    }, 0);
  }

  function onEllipsisKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu('last');
    }
  }

  function onMenuItemKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      // Close without moving focus off its natural next stop (no trap).
      pendingFocusRef.current = null;
      setOpen(false);
    }
  }

  function onNavBlur(event: React.FocusEvent<HTMLElement>): void {
    if (event.relatedTarget instanceof Node && navRef.current?.contains(event.relatedTarget))
      return;
    if (event.relatedTarget === null) return; // pointer interactions are handled by click-outside
    pendingFocusRef.current = null;
    setOpen(false);
  }

  function renderHomeContent() {
    // Decision (not specified): a `Home` lucide icon sits beside the text at
    // widths >= 480px and stands alone below it; the accessible name stays
    // "Home" in both layouts via an explicit aria-label on the button.
    return (
      <>
        <span className={styles.homeIcon} aria-hidden="true">
          <Icon icon={Home} size={16} />
        </span>
        <span className={styles.homeText}>Home</span>
      </>
    );
  }

  function renderSegment(segment: TrailSegment, isCurrent: boolean) {
    const isHome = segment.path === '';
    const title = isHome ? (rootTitle ?? segment.label) : segment.label;
    if (isCurrent) {
      return (
        <span
          ref={currentRef}
          tabIndex={-1}
          aria-current="page"
          title={title}
          className={styles.current}
        >
          {isHome ? renderHomeContent() : segment.label}
        </span>
      );
    }
    if (isHome) {
      return (
        <button
          type="button"
          aria-label="Home"
          title={title}
          onClick={() => onNavigate(segment.path)}
          className={cx(styles.segment, styles.homeSegment)}
        >
          {renderHomeContent()}
        </button>
      );
    }
    return (
      <button
        type="button"
        title={title}
        onClick={() => onNavigate(segment.path)}
        className={styles.segment}
      >
        {segment.label}
      </button>
    );
  }

  return (
    <nav
      ref={navRef}
      aria-label={ariaLabel}
      className={cx(styles.nav, className)}
      onBlur={onNavBlur}
    >
      <ol ref={containerRef as React.RefObject<HTMLOListElement | null>} className={styles.list}>
        {trail.map((node, index) =>
          node.kind === 'ellipsis' ? (
            <li key="ellipsis" className={cx(styles.item, styles.ellipsisItem)}>
              {index > 0 && (
                <span aria-hidden="true" className={styles.separator} data-separator="">
                  <Icon icon={ChevronRight} size={16} />
                </span>
              )}
              <span className={styles.ellipsisWrap}>
                <button
                  ref={ellipsisRef}
                  type="button"
                  aria-label="Show hidden folders"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-controls={open ? menuId : undefined}
                  title="Show hidden folders"
                  onClick={() => (open ? closeMenu(false) : openMenu('first'))}
                  onKeyDown={onEllipsisKeyDown}
                  className={styles.ellipsis}
                >
                  <Icon icon={Ellipsis} size={20} />
                </button>
                {open && (
                  <ul
                    ref={menuRef}
                    role="menu"
                    id={menuId}
                    aria-label="Hidden folders"
                    className={styles.menu}
                  >
                    {hidden.map((entry) => (
                      <li key={entry.path} role="none" className={styles.menuItem}>
                        <button
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          title={entry.path === '' ? (rootTitle ?? entry.label) : entry.label}
                          onClick={() => choose(entry)}
                          onKeyDown={onMenuItemKeyDown}
                          className={styles.menuButton}
                        >
                          {entry.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ) : (
            <li key={node.segment.path} className={styles.item}>
              {index > 0 && (
                <span aria-hidden="true" className={styles.separator} data-separator="">
                  <Icon icon={ChevronRight} size={16} />
                </span>
              )}
              {renderSegment(node.segment, node.segment.path === last?.path)}
            </li>
          ),
        )}
      </ol>
      {/* Hidden measuring clone: spans (not buttons) so no focusable content hides
          inside aria-hidden; widths approximate the visible buttons.
          Approximation error: the spans reuse the .segment/.ellipsis classes
          (padding, type, zeroed border via .measureSegment) but miss native
          button metrics (UA font inheritance and button chrome), so measured
          widths can differ by a few px per item. Residual overflow is absorbed
          by per-label max-width truncation, and the pinned Home + last two
          segments are never hidden, so the error only shifts the collapse
          threshold by one middle segment at most. */}
      {!overrideWins && !capped && count > 3 && (
        <ol
          ref={measureRef as React.RefObject<HTMLOListElement | null>}
          aria-hidden="true"
          inert
          className={styles.measure}
        >
          {segments.map((segment) => (
            <li key={segment.path} data-measure-item="" className={styles.measureItem}>
              <span className={cx(styles.segment, styles.measureSegment)}>{segment.label}</span>
            </li>
          ))}
          <li data-measure-item="" className={styles.measureItem}>
            <span className={cx(styles.ellipsis, styles.measureSegment)}>
              <Icon icon={Ellipsis} size={20} />
            </span>
          </li>
        </ol>
      )}
    </nav>
  );
}
