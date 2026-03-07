import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CreateBeadDialog } from '../create-bead-dialog';

// Mock the api module
vi.mock('@/lib/api', () => ({
  beads: {
    create: vi.fn().mockResolvedValue({ id: 'test-id' }),
  },
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectPath: '/test/project',
  onCreated: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreateBeadDialog', () => {
  it('renders with title "New Bead" when parentId is not set', () => {
    render(<CreateBeadDialog {...defaultProps} />);
    expect(screen.getByText('New Bead')).toBeInTheDocument();
  });

  it('renders with title "New Subtask" when parentId is set', () => {
    render(<CreateBeadDialog {...defaultProps} parentId="parent-123" />);
    expect(screen.getByText('New Subtask')).toBeInTheDocument();
  });

  it('disables Create button when title is empty', () => {
    render(<CreateBeadDialog {...defaultProps} />);
    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).toBeDisabled();
  });

  it('enables Create button when title has text', () => {
    render(<CreateBeadDialog {...defaultProps} />);
    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    fireEvent.change(titleInput, { target: { value: 'My new bead' } });
    const createButton = screen.getByRole('button', { name: 'Create' });
    expect(createButton).toBeEnabled();
  });

  it('calls onOpenChange with false when Cancel is clicked', () => {
    render(<CreateBeadDialog {...defaultProps} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resets form fields when Cancel is clicked (close triggers reset)', () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(
      <CreateBeadDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    // Type something into the title
    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    fireEvent.change(titleInput, { target: { value: 'Some title' } });
    expect(titleInput).toHaveValue('Some title');

    // Click Cancel — this calls handleOpenChange(false) which resets the form
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    // onOpenChange is called, and internal resetForm clears the state
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // The title input should now be empty (resetForm was called)
    expect(titleInput).toHaveValue('');

    unmount();
  });
});
