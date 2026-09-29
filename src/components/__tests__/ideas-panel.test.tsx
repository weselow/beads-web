import type { ComponentProps } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferDate } from '@/lib/ideas';
import { READ_ONLY_HINT } from '@/lib/read-only';
import { BUILTIN_STATUSES } from '@/lib/statuses';
import type { Bead } from '@/types';

import { IdeasPanel } from '../ideas-panel';
import { QuickFilterBar } from '../quick-filter-bar';

import type { IdeasPanelProps } from '../ideas-panel';

// The panel writes through the beads API and closes through bd; neither may
// reach a real backend here.
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockClose = vi.fn();
const mockToast = vi.fn();

vi.mock('@/lib/api', () => ({
  beads: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock('@/lib/cli', () => ({
  closeBead: (...args: unknown[]) => mockClose(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Radix menus call pointer and scroll methods jsdom does not have.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'new' });
  mockUpdate.mockResolvedValue({ success: true });
  mockClose.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const DAY_MS = 24 * 60 * 60 * 1000;

function makeStory(id: string, overrides: Partial<Bead> = {}): Bead {
  const created = new Date(Date.now() - 2 * DAY_MS).toISOString();
  return {
    id,
    title: `Idea ${id}`,
    description: 'Why it matters',
    status: 'open',
    priority: 2,
    issue_type: 'story',
    owner: 'tester',
    created_at: created,
    updated_at: created,
    comments: [],
    ...overrides,
  };
}

function renderPanel(props: Partial<IdeasPanelProps> = {}) {
  const handlers = { onOpenBead: vi.fn(), onChanged: vi.fn(), onOpenChange: vi.fn() };
  render(
    <IdeasPanel
      open
      beads={[makeStory('s1')]}
      statuses={BUILTIN_STATUSES}
      projectPath="M:/demo"
      fsPath="M:/demo"
      isDoltOnly={false}
      readOnly={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

function captureInput() {
  return screen.getByRole('textbox', { name: 'New idea' });
}

describe('quick capture', () => {
  it('creates a story on Enter and clears the field', async () => {
    const { onChanged } = renderPanel();
    fireEvent.change(captureInput(), { target: { value: '  Dark mode for print  ' } });
    fireEvent.keyDown(captureInput(), { key: 'Enter' });

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({ path: 'M:/demo', title: 'Dark mode for print', issue_type: 'story' });
    expect(captureInput()).toHaveValue('');
  });

  it('does not send an empty idea', () => {
    renderPanel();
    fireEvent.change(captureInput(), { target: { value: '   ' } });
    fireEvent.keyDown(captureInput(), { key: 'Enter' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows the error in the panel and keeps the text', async () => {
    mockCreate.mockRejectedValue(new Error('bd is gone'));
    renderPanel();
    fireEvent.change(captureInput(), { target: { value: 'Keep me' } });
    fireEvent.keyDown(captureInput(), { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent('bd is gone');
    expect(captureInput()).toHaveValue('Keep me');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('the list', () => {
  it('opens the bead when the title is clicked', () => {
    const story = makeStory('s1');
    const { onOpenBead } = renderPanel({ beads: [story] });
    fireEvent.click(screen.getByRole('button', { name: 'Idea s1' }));
    expect(onOpenBead).toHaveBeenCalledWith(story);
  });

  it('shows the comment count and marks an old idea', () => {
    const comment = { id: 1, issue_id: 'old', author: 'a', text: 't', created_at: '2026-01-01T00:00:00Z' };
    const old = makeStory('old', { created_at: new Date(Date.now() - 120 * DAY_MS).toISOString(), comments: [comment] });
    renderPanel({ beads: [old] });
    expect(screen.getByText('1 comment')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('keeps deferred ideas in a collapsed block with their return date', () => {
    const deferred = makeStory('d1', { status: 'deferred', defer_until: '2031-03-10T12:00:00Z' });
    renderPanel({ beads: [makeStory('s1'), deferred] });

    expect(screen.queryByText('Idea d1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Deferred/ }));
    expect(screen.getByText('Idea d1')).toBeInTheDocument();
    expect(screen.getByText(/Back Mar 10, 2031/)).toBeInTheDocument();
  });
});

describe('actions', () => {
  it('promotes an idea with one update and refreshes the board', async () => {
    const { onChanged } = renderPanel();
    openMenu('Promote');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Epic' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ path: 'M:/demo', id: 's1', issue_type: 'epic', status: 'open', defer: '' });
  });

  it('defers an idea by a week', async () => {
    renderPanel();
    openMenu('Defer');
    fireEvent.click(screen.getByRole('menuitem', { name: 'In a week' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ path: 'M:/demo', id: 's1', defer: deferDate('week', new Date()) });
  });

  it('defers an idea to a picked date', async () => {
    renderPanel();
    openMenu('Defer');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick a date…' }));
    fireEvent.change(screen.getByLabelText('Defer until'), { target: { value: '2031-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Defer idea' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ path: 'M:/demo', id: 's1', defer: '2031-12-01' });
  });

  it('brings a deferred idea back', async () => {
    renderPanel({ beads: [makeStory('d1', { status: 'deferred' })] });
    fireEvent.click(screen.getByRole('button', { name: /Deferred/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({ path: 'M:/demo', id: 'd1', defer: '' });
  });

  it('dismisses an idea with a reason', async () => {
    const { onChanged } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason (optional)' }), { target: { value: 'Not needed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss idea' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockClose).toHaveBeenCalledWith('s1', 'M:/demo', 'Not needed');
  });

  it('reports a failed action', async () => {
    mockUpdate.mockRejectedValue(new Error('no database'));
    const { onChanged } = renderPanel();
    openMenu('Promote');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockToast.mock.calls[0][0]).toMatchObject({ variant: 'destructive', description: 'no database' });
    expect(console.error).toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('turns Dismiss off without a project folder', () => {
    renderPanel({ isDoltOnly: true, fsPath: '' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toBeDisabled();
    expect(dismiss).toHaveAttribute('title', 'Requires project folder path');
    expect(screen.getByRole('button', { name: 'Promote' })).toBeEnabled();
  });

  it('turns capture and every action off on an old copy', () => {
    renderPanel({ readOnly: true });
    for (const element of [
      captureInput(),
      screen.getByRole('button', { name: 'Promote' }),
      screen.getByRole('button', { name: 'Defer' }),
      screen.getByRole('button', { name: 'Dismiss' }),
    ]) {
      expect(element).toBeDisabled();
      expect(element).toHaveAttribute('title', READ_ONLY_HINT);
    }
  });
});

describe('Ideas button in the filter bar', () => {
  function renderBar(props: Partial<ComponentProps<typeof QuickFilterBar>> = {}) {
    const onIdeasToggle = vi.fn();
    render(
      <QuickFilterBar
        typeFilter="all"
        onTypeFilterChange={vi.fn()}
        todayOnly={false}
        onTodayOnlyChange={vi.fn()}
        sortField="ticket_number"
        sortDirection="desc"
        onSortChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        statusOptions={[]}
        statuses={[]}
        onStatusToggle={vi.fn()}
        owners={[]}
        onOwnerToggle={vi.fn()}
        availableOwners={[]}
        onClearFilters={vi.fn()}
        hasActiveFilters={false}
        onIdeasToggle={onIdeasToggle}
        {...props}
      />,
    );
    return onIdeasToggle;
  }

  it('shows the number of open ideas and toggles the panel', () => {
    const onIdeasToggle = renderBar({ ideasCount: 4 });
    const button = screen.getByRole('button', { name: /Ideas/ });
    expect(button).toHaveTextContent('4');
    fireEvent.click(button);
    expect(onIdeasToggle).toHaveBeenCalledTimes(1);
  });

  it('shows no number when there are no ideas', () => {
    renderBar({ ideasCount: 0 });
    expect(screen.getByRole('button', { name: /Ideas/ })).toHaveTextContent(/^Ideas$/);
  });

  it('works without a project folder', () => {
    renderBar({ hasProjectPath: false });
    expect(screen.getByRole('button', { name: /Ideas/ })).toBeEnabled();
  });
});
