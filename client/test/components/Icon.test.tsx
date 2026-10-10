import { render, screen } from '@testing-library/react';
import { Folder } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../../src/components/Icon';

describe('Icon', () => {
  it('is aria-hidden and not focusable by default', () => {
    const { container } = render(<Icon icon={Folder} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
  });

  it('with label exposes role="img" and aria-label and drops aria-hidden', () => {
    render(<Icon icon={Folder} label="Folder" />);
    const img = screen.getByRole('img', { name: 'Folder' });
    expect(img).toHaveAttribute('aria-label', 'Folder');
    expect(img).not.toHaveAttribute('aria-hidden');
    expect(img).toHaveAttribute('focusable', 'false');
  });

  it('forwards size and className', () => {
    const { container } = render(
      <Icon icon={Folder} size={32} strokeWidth={1.5} className="custom" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
    expect(svg?.className.baseVal ?? svg?.getAttribute('class')).toContain('custom');
    expect(svg?.className.baseVal ?? svg?.getAttribute('class')).toContain('icon');
  });
});
