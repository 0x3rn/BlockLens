import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps healthy content visible', () => {
  render(<AppErrorBoundary><h1>Trade</h1></AppErrorBoundary>);
  expect(screen.getByRole('heading', { name: 'Trade' })).toBeInTheDocument();
});
it('shows a useful retry screen after a render crash', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const BrokenPage = () => { throw new Error('internal error with sensitive details'); };
  render(<AppErrorBoundary><BrokenPage /></AppErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load this page.');
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeEnabled();
  expect(screen.queryByText(/sensitive details/)).not.toBeInTheDocument();
});
