import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({ bd: { command: vi.fn() }, beads: { close: vi.fn(), comment: vi.fn() } }));

import * as api from '../api'; // eslint-disable-line import/first
import { addComment, closeBead } from '../cli'; // eslint-disable-line import/first

const command = vi.mocked(api.bd.command);
const close = vi.mocked(api.beads.close);
const comment = vi.mocked(api.beads.comment);

beforeEach(() => {
  command.mockReset();
  close.mockReset();
  close.mockResolvedValue({ success: true });
  comment.mockReset();
  comment.mockResolvedValue({ success: true });
});

describe('addComment', () => {
  it('comments through the beads API, not a bd command', async () => {
    await addComment('x-1', 'Looks good', '/p');
    expect(comment).toHaveBeenCalledWith({ path: '/p', id: 'x-1', text: 'Looks good' });
    expect(command).not.toHaveBeenCalled();
  });

  it('works for a dolt-only project and passes the text untouched', async () => {
    await addComment('x-1', '-not a flag; "really"', 'dolt://beads_x');
    expect(comment).toHaveBeenCalledWith({ path: 'dolt://beads_x', id: 'x-1', text: '-not a flag; "really"' });
  });

  it('refuses without a project path and calls nothing', async () => {
    await expect(addComment('x-1', 'hi')).rejects.toThrow('no project path');
    expect(comment).not.toHaveBeenCalled();
  });

  it('passes the server error on', async () => {
    comment.mockRejectedValue(new Error('Bead not found: x-1'));
    await expect(addComment('x-1', 'hi', '/p')).rejects.toThrow('Bead not found: x-1');
  });
});

describe('closeBead', () => {
  it('closes through the beads API, not a bd command', async () => {
    await closeBead('x-1', '/p');
    expect(close).toHaveBeenCalledWith({ path: '/p', id: 'x-1' });
    expect(command).not.toHaveBeenCalled();
  });

  it('works for a dolt-only project', async () => {
    await closeBead('x-1', 'dolt://beads_x', 'Not needed');
    expect(close).toHaveBeenCalledWith({ path: 'dolt://beads_x', id: 'x-1', reason: 'Not needed' });
  });

  it('passes the reason untouched', async () => {
    await closeBead('x-1', '/p', '-not needed; "really"');
    expect(close).toHaveBeenCalledWith({ path: '/p', id: 'x-1', reason: '-not needed; "really"' });
  });

  it('leaves out a blank reason', async () => {
    await closeBead('x-1', '/p', '   ');
    expect(close).toHaveBeenCalledWith({ path: '/p', id: 'x-1' });
  });

  it('refuses without a project path and calls nothing', async () => {
    await expect(closeBead('x-1')).rejects.toThrow('no project path');
    expect(close).not.toHaveBeenCalled();
  });

  it('passes the server error on', async () => {
    close.mockRejectedValue(new Error('Bead not found: x-1'));
    await expect(closeBead('x-1', '/p', 'dup')).rejects.toThrow('Bead not found: x-1');
  });
});
