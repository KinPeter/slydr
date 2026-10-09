import { describe, it, expect } from 'vitest';
import { isAllowedHost } from '../../src/middleware/hostCheck.js';

describe('isAllowedHost', () => {
  it('allows localhost', () => {
    expect(isAllowedHost('localhost')).toBe(true);
  });

  it('allows localhost case-insensitively', () => {
    expect(isAllowedHost('LOCALHOST')).toBe(true);
    expect(isAllowedHost('LocalHost')).toBe(true);
  });

  it('allows localhost with port', () => {
    expect(isAllowedHost('localhost:4317')).toBe(true);
  });

  it('allows 127.0.0.1', () => {
    expect(isAllowedHost('127.0.0.1')).toBe(true);
  });

  it('allows 127.0.0.1 with port', () => {
    expect(isAllowedHost('127.0.0.1:4317')).toBe(true);
  });

  it('allows [::1]', () => {
    expect(isAllowedHost('[::1]')).toBe(true);
  });

  it('allows [::1] with port', () => {
    expect(isAllowedHost('[::1]:4317')).toBe(true);
  });

  it('rejects bare ::1 (IPv6 without brackets)', () => {
    expect(isAllowedHost('::1')).toBe(false);
  });

  it('rejects undefined Host header', () => {
    expect(isAllowedHost(undefined)).toBe(false);
  });

  it('rejects empty Host header', () => {
    expect(isAllowedHost('')).toBe(false);
  });

  it('rejects array-valued Host header', () => {
    expect(isAllowedHost(['localhost', 'evil.example'])).toBe(false);
  });

  it('rejects evil.example', () => {
    expect(isAllowedHost('evil.example')).toBe(false);
  });

  it('rejects evil.example with port', () => {
    expect(isAllowedHost('evil.example:4317')).toBe(false);
  });

  it('rejects 127.0.0.2', () => {
    expect(isAllowedHost('127.0.0.2')).toBe(false);
  });

  it('rejects localhost.evil.example', () => {
    expect(isAllowedHost('localhost.evil.example')).toBe(false);
  });

  it('rejects localhost with invalid port', () => {
    expect(isAllowedHost('localhost:abc')).toBe(false);
    expect(isAllowedHost('localhost:123456')).toBe(false);
  });

  it('rejects userinfo in Host', () => {
    expect(isAllowedHost('user@localhost')).toBe(false);
  });

  it('rejects Host with leading/trailing whitespace', () => {
    expect(isAllowedHost(' localhost ')).toBe(false);
    expect(isAllowedHost('\tlocalhost')).toBe(false);
  });

  it('rejects 0.0.0.0', () => {
    expect(isAllowedHost('0.0.0.0')).toBe(false);
  });

  it('rejects malformed IPv6 with trailing characters', () => {
    expect(isAllowedHost('[::1]:4317extra')).toBe(false);
  });
});
