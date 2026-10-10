import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayerBackground } from '../../../src/screens/Player/PlayerBackground';
import type { PlayerSlide } from '../../../src/screens/Player/types';
import styles from '../../../src/screens/Player/PlayerBackground.module.css';

function slide(key: string, src = `/api/image?path=${key}.jpg`): PlayerSlide {
  return {
    key,
    position: 0,
    cycle: 0,
    item: { name: `${key}.jpg`, path: `${key}.jpg`, dir: '', size: 1, mtimeMs: 1 },
    src,
  };
}

describe('PlayerBackground', () => {
  it('renders only the flat layer when fillEmptySpace is off', () => {
    const { container } = render(
      <PlayerBackground fillEmptySpace={false} current={slide('a')} previous={null} />,
    );
    const background = container.firstElementChild;
    expect(background?.querySelectorAll('.flat')).toHaveLength(1);
    expect(background?.querySelectorAll('img')).toHaveLength(0);
    expect(background).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the current slide URL for the cover and keeps the flat layer underneath', () => {
    const current = slide('current', '/api/image?path=photo.jpg');
    const { container } = render(
      <PlayerBackground fillEmptySpace current={current} previous={null} />,
    );
    const background = container.firstElementChild;
    const image = background?.querySelector('img');
    expect(background?.querySelector('.flat')).toBeTruthy();
    expect(image).toHaveAttribute('src', current.src);
    expect(image).toHaveAttribute('data-bg', 'true');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the first cover immediately without the incoming animation', () => {
    const { container } = render(
      <PlayerBackground fillEmptySpace current={slide('first')} previous={null} />,
    );

    expect(container.querySelector('img')).not.toHaveClass(styles.coverIn!);
  });

  it('renders outgoing before incoming and keeps at most two covers', () => {
    const { container } = render(
      <PlayerBackground fillEmptySpace current={slide('b')} previous={slide('a')} />,
    );
    const images = [...container.querySelectorAll('img')];
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', '/api/image?path=a.jpg');
    expect(images[1]).toHaveAttribute('src', '/api/image?path=b.jpg');
    expect(images.every((image) => image.dataset.bg === 'true')).toBe(true);
  });

  it('hides a cover after it fails without reporting to the engine', () => {
    const reporter = vi.fn();
    const { container } = render(
      <div data-reporter={reporter}>
        <PlayerBackground fillEmptySpace current={slide('a')} previous={null} />
      </div>,
    );
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(image).toHaveClass('coverFailed');
    expect(reporter).not.toHaveBeenCalled();
  });

  it('keeps a cover DOM node when it moves from current to previous', () => {
    const first = slide('a');
    const { container, rerender } = render(
      <PlayerBackground fillEmptySpace current={first} previous={null} />,
    );
    const image = container.querySelector('img');
    rerender(<PlayerBackground fillEmptySpace current={slide('b')} previous={first} />);
    expect(container.querySelector('img[src="/api/image?path=a.jpg"]')).toBe(image);
  });

  it('remounts a cover when a loop occurrence gets a new key', () => {
    const first = slide('0:4', '/api/image?path=photo.jpg');
    const nextOccurrence = slide('1:0', first.src);
    const { container, rerender } = render(
      <PlayerBackground fillEmptySpace current={first} previous={null} />,
    );
    const firstImage = container.querySelector('img');

    rerender(<PlayerBackground fillEmptySpace current={nextOccurrence} previous={null} />);

    expect(container.querySelector('img')).not.toBe(firstImage);
  });

  it('keeps the foreground source in the background source set', () => {
    const current = slide('current', '/api/image?path=current.jpg');
    const { container } = render(
      <div>
        <img src={current.src} alt="" />
        <PlayerBackground fillEmptySpace current={current} previous={null} />
      </div>,
    );
    const sources = new Set(
      [...container.querySelectorAll('img')].map((image) => image.getAttribute('src')),
    );

    expect(sources).toEqual(new Set([current.src]));
    expect(container.querySelector('img[data-bg="true"]')).toHaveAttribute('src', current.src);
  });
});
