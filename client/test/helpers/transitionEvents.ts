import { act } from '@testing-library/react';

export function fireTransitionEnd(el: Element, propertyName = 'opacity'): void {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  act(() => el.dispatchEvent(event));
}

export function fireAnimationEnd(el: Element): void {
  const event = new Event('animationend', { bubbles: true });
  act(() => el.dispatchEvent(event));
}
