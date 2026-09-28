import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UpdateBanner } from '../update-banner';

// Mock the api module
const mockCheck = vi.fn();
const mockPerform = vi.fn();
vi.mock('@/lib/api', () => ({
  version: {
    get check() {
      return mockCheck;
    },
  },
  update: {
    get perform() {
      return mockPerform;
    },
  },
}));

const OLD = {
  current: '0.3.0',
  latest: '0.4.0',
  update_available: true,
  download_url: 'https://github.com/example/releases/v0.4.0',
  release_notes: null,
  asset_url: 'https://github.com/example/releases/download/v0.4.0/bin',
};
const NEW = { ...OLD, current: '0.4.0', update_available: false };

beforeEach(() => {
  // reset, not clear: leftover mockResolvedValueOnce answers must not leak
  vi.resetAllMocks();
});

describe('UpdateBanner', () => {
  it('does not render when update_available is false', async () => {
    mockCheck.mockResolvedValue({
      current: '0.3.0',
      latest: '0.3.0',
      update_available: false,
      download_url: null,
      release_notes: null,
    });

    const { container } = render(<UpdateBanner />);

    // Wait for the async check to resolve
    await waitFor(() => {
      expect(mockCheck).toHaveBeenCalled();
    });

    // Banner should not be rendered
    expect(container.firstChild).toBeNull();
  });

  it('renders download link when update is available', async () => {
    mockCheck.mockResolvedValue({
      current: '0.3.0',
      latest: '0.4.0',
      update_available: true,
      download_url: 'https://github.com/example/releases/v0.4.0',
      release_notes: 'Bug fixes',
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText('Update available: v0.4.0')).toBeInTheDocument();
    });

    const link = screen.getByText('GitHub');
    expect(link).toHaveAttribute('href', 'https://github.com/example/releases/v0.4.0');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('hides banner when dismiss button is clicked', async () => {
    mockCheck.mockResolvedValue({
      current: '0.3.0',
      latest: '0.4.0',
      update_available: true,
      download_url: 'https://github.com/example/releases/v0.4.0',
      release_notes: null,
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText('Update available: v0.4.0')).toBeInTheDocument();
    });

    const dismissButton = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissButton);

    expect(screen.queryByText('Update available: v0.4.0')).not.toBeInTheDocument();
  });

  it('shows current version text', async () => {
    mockCheck.mockResolvedValue({
      current: '0.3.0',
      latest: '0.4.0',
      update_available: true,
      download_url: null,
      release_notes: null,
    });

    render(<UpdateBanner />);

    await waitFor(() => {
      expect(screen.getByText(/You're running v0\.3\.0/)).toBeInTheDocument();
    });
  });
});

// ── Fake-timer tests: re-check on tab return, wait for the new version ──

let visibility: DocumentVisibilityState = 'visible';
const originalLocation = window.location;
const reload = vi.fn();

/** Let pending promises settle and move the fake clock forward. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function switchTab(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('UpdateBanner with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  describe('re-check when the tab becomes visible', () => {
    it('re-checks and hides the banner once the server is already updated', async () => {
      mockCheck.mockResolvedValueOnce(OLD).mockResolvedValue(NEW);
      render(<UpdateBanner />);
      await advance(0);
      expect(screen.getByText('Update available: v0.4.0')).toBeInTheDocument();

      switchTab('hidden');
      await advance(60_000);
      switchTab('visible');
      await advance(0);

      expect(mockCheck).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Update available: v0.4.0')).not.toBeInTheDocument();
    });

    it('does not re-check more than once per 30 seconds', async () => {
      mockCheck.mockResolvedValue(OLD);
      render(<UpdateBanner />);
      await advance(0);

      await advance(10_000);
      switchTab('hidden');
      switchTab('visible');
      await advance(0);
      expect(mockCheck).toHaveBeenCalledTimes(1);

      await advance(25_000);
      switchTab('hidden');
      switchTab('visible');
      await advance(0);
      expect(mockCheck).toHaveBeenCalledTimes(2);

      switchTab('hidden');
      switchTab('visible');
      await advance(0);
      expect(mockCheck).toHaveBeenCalledTimes(2);
    });

    it('does not re-check when the tab is hidden', async () => {
      mockCheck.mockResolvedValue(OLD);
      render(<UpdateBanner />);
      await advance(60_000);

      switchTab('hidden');
      await advance(0);

      expect(mockCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('after Update & Restart', () => {
    async function clickUpdate() {
      render(<UpdateBanner />);
      await advance(0);
      fireEvent.click(screen.getByRole('button', { name: /Update & Restart/ }));
      await advance(0);
    }

    it('waits until the server reports the new version before reloading', async () => {
      mockPerform.mockResolvedValue({ status: 'updating' });
      mockCheck
        .mockResolvedValueOnce(OLD) // on mount
        .mockResolvedValueOnce(OLD) // old server still answering
        .mockRejectedValueOnce(new Error('connection refused')) // restarting
        .mockResolvedValue(NEW); // new server
      await clickUpdate();
      expect(screen.getByText(/Restarting server/)).toBeInTheDocument();

      await advance(3_000); // first poll: old version
      expect(reload).not.toHaveBeenCalled();
      await advance(1_000); // second poll: server down
      expect(reload).not.toHaveBeenCalled();
      await advance(1_000); // third poll: new version

      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads anyway after 20 attempts when the version never changes', async () => {
      mockPerform.mockResolvedValue({ status: 'updating' });
      mockCheck.mockResolvedValue(OLD);
      await clickUpdate();

      await advance(3_000 + 18 * 1_000);
      expect(reload).not.toHaveBeenCalled();

      await advance(5_000);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(mockCheck).toHaveBeenCalledTimes(1 + 20);
    });

    it('does not restart when the server says it is already up to date', async () => {
      mockPerform.mockResolvedValue({ status: 'up_to_date', message: 'Already up to date (v0.4.0)' });
      mockCheck.mockResolvedValueOnce(OLD).mockResolvedValue(NEW);
      await clickUpdate();
      await advance(30_000);

      expect(reload).not.toHaveBeenCalled();
      expect(screen.queryByText(/Restarting server/)).not.toBeInTheDocument();
      expect(screen.queryByText('Update available: v0.4.0')).not.toBeInTheDocument();
    });
  });
});
