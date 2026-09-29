import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({ bd: { command: vi.fn() } }));

import * as api from '../api'; // eslint-disable-line import/first
import { closeBead } from '../cli'; // eslint-disable-line import/first

const command = vi.mocked(api.bd.command);

beforeEach(() => {
  command.mockReset();
  command.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
});

describe('closeBead', () => {
  it('closes without a reason as before', async () => {
    await closeBead('x-1', '/p');
    expect(command).toHaveBeenCalledWith(['close', 'x-1'], '/p');
  });

  it('passes the reason as one argument glued to the flag', async () => {
    // Glued, so a reason starting with "-" is never read as a flag.
    await closeBead('x-1', '/p', '-not needed; "really"');
    expect(command).toHaveBeenCalledWith(['close', 'x-1', '--reason=-not needed; "really"'], '/p');
  });

  it('leaves out a blank reason', async () => {
    await closeBead('x-1', '/p', '   ');
    expect(command).toHaveBeenCalledWith(['close', 'x-1'], '/p');
  });

  it('throws with bd error text when bd fails', async () => {
    command.mockResolvedValue({ stdout: '', stderr: 'no issue found', code: 1 });
    await expect(closeBead('x-1', '/p', 'dup')).rejects.toThrow('no issue found');
  });
});
