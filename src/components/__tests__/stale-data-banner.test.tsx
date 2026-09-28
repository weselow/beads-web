import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StaleDataBanner } from '../stale-data-banner';

// Midday UTC, so the date is the same in every time zone the tests run in.
const stale = {
  reason: 'bd exited with exit code: 1: Error: no beads database found\nHint: run bd init',
  modifiedAt: '2026-07-15T12:00:00Z',
};

describe('StaleDataBanner', () => {
  it('says the board shows an old copy from the file date', () => {
    render(<StaleDataBanner stale={stale} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      "Showing an old copy from Jul 15, 2026 — bd can't open the database",
    );
  });

  it('says "an old copy" when the file date is unknown', () => {
    render(<StaleDataBanner stale={{ reason: 'bd timed out' }} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      "Showing an old copy — bd can't open the database",
    );
  });

  it('keeps the reason collapsed until asked, then shows it with its line breaks', () => {
    render(<StaleDataBanner stale={stale} />);

    expect(screen.queryByText(/no beads database found/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /reason/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const reason = screen.getByText(/no beads database found/);
    expect(reason.textContent).toBe(stale.reason);
    expect(reason).toHaveClass('whitespace-pre-wrap');

    fireEvent.click(toggle);
    expect(screen.queryByText(/no beads database found/)).not.toBeInTheDocument();
  });
});
