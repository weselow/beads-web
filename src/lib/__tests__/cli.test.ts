import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({ bd: { command: vi.fn() }, beads: { close: vi.fn() } }));

import * as api from '../api'; // eslint-disable-line import/first
import { closeBead } from '../cli'; // eslint-disable-line import/first

const command = vi.mocked(api.bd.command);
const close = vi.mocked(api.beads.close);

beforeEach(() => {
  command.mockReset();
  close.mockReset();
  close.mockResolvedValue({ success: true });
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
