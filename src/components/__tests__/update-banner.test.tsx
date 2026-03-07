import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { UpdateBanner } from '../update-banner';

// Mock the api module
const mockCheck = vi.fn();
vi.mock('@/lib/api', () => ({
  version: {
    get check() {
      return mockCheck;
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
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

    const link = screen.getByText('Download from GitHub');
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
