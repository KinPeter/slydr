import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Gallery } from '../../src/components/gallery/Gallery';

describe('Gallery', () => {
  it('renders without throwing and contains one instance of each exported component', () => {
    const { container } = render(<Gallery />);

    const root = container.querySelector('[data-gallery="slydr-component-gallery"]');
    expect(root).not.toBeNull();

    // Button (+ IconButton), Checkbox, Slider.
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('slider').length).toBeGreaterThan(0);

    // Breadcrumb landmark, Banner live regions.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});
