import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { journal } from '@/lib/api';

import { JournalSwitch, journalHint } from '../journal-switch';

vi.mock('@/lib/api', () => ({
  journal: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

const getMock = vi.mocked(journal.get);
const setMock = vi.mocked(journal.set);

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ enabled: false, forced_by_env: false });
});

describe('JournalSwitch visibility', () => {
  it('is hidden for a project read from an old issues.jsonl export', () => {
    const { container } = render(<JournalSwitch projectPath="/p" source="jsonl" />);
    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
  });

  it.each(['dolt-project', 'dolt-central', 'dolt-direct'])(
    'shows a Direct SQL label instead of the switch for %s',
    (source) => {
      render(<JournalSwitch projectPath="/p" source={source} />);
      const label = screen.getByText('Direct SQL');
      expect(label).toHaveAccessibleDescription(/Dolt SQL server/);
      expect(label).toHaveAccessibleDescription(/journal is not used/);
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(getMock).not.toHaveBeenCalled();
    },
  );

  it('passes the header class on to the Direct SQL label', () => {
    render(<JournalSwitch projectPath="/p" source="dolt-project" className="font-mono uppercase" />);
    expect(screen.getByText('Direct SQL')).toHaveClass('font-mono', 'uppercase', 'text-t-muted');
  });

  it('is hidden before the first read reports a source', () => {
    const { container } = render(<JournalSwitch projectPath="/p" source={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is shown off for a project read through bd', async () => {
    render(<JournalSwitch projectPath="/p" source="cli" />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(getMock).toHaveBeenCalledWith('/p');
  });

  it('is shown on for a project read through the journal', async () => {
    getMock.mockResolvedValue({ enabled: true, forced_by_env: false });
    render(<JournalSwitch projectPath="/p" source="cli-journal" />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByText('Direct SQL')).not.toBeInTheDocument();
  });
});

describe('JournalSwitch forced by the environment', () => {
  it('is disabled and says why', async () => {
    getMock.mockResolvedValue({ enabled: true, forced_by_env: true });
    render(<JournalSwitch projectPath="/p" source="cli-journal" />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription(/BD_EVENTS_JOURNAL/);
  });
});

describe('JournalSwitch toggling', () => {
  it('turns the journal on through the API and reports the change', async () => {
    setMock.mockResolvedValue({ enabled: true, forced_by_env: false });
    const onChanged = vi.fn();
    render(<JournalSwitch projectPath="/p" source="cli" onChanged={onChanged} />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(setMock).toHaveBeenCalledWith('/p', true);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows the error and keeps the old state when the switch fails', async () => {
    setMock.mockRejectedValue(new Error('API error: 500 bd config set failed: boom'));
    const onChanged = vi.fn();
    render(<JournalSwitch projectPath="/p" source="cli" onChanged={onChanged} />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
      description: expect.stringContaining('boom'),
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('stays disabled with the reason when the state cannot be read', async () => {
    getMock.mockRejectedValue(new Error('API error: 404 No .beads directory'));
    render(<JournalSwitch projectPath="/p" source="cli" />);
    const toggle = await screen.findByRole('switch', { name: /journal/i });
    await waitFor(() => expect(toggle).toHaveAccessibleDescription(/No \.beads directory/));
    expect(toggle).toBeDisabled();
  });
});

describe('journalHint', () => {
  it('explains the on state and warns about agents', () => {
    const hint = journalHint({ enabled: true, forced_by_env: false }, null);
    expect(hint).toMatch(/on/);
    expect(hint).toMatch(/journal/);
    expect(hint).toMatch(/agents included/);
  });

  it('explains the off state', () => {
    const hint = journalHint({ enabled: false, forced_by_env: false }, null);
    expect(hint).toMatch(/off/);
    expect(hint).toMatch(/re-reads all tasks/);
  });
});
