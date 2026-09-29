import { describe, expect, it } from 'vitest';

import { parseProjectView, projectViewSearch } from '../project-view';

describe('parseProjectView', () => {
  it('reads tree', () => {
    expect(parseProjectView('tree')).toBe('tree');
  });

  it('falls back to the board without the parameter or with an unknown value', () => {
    expect(parseProjectView(null)).toBe('board');
    expect(parseProjectView('')).toBe('board');
    expect(parseProjectView('list')).toBe('board');
    expect(parseProjectView('board')).toBe('board');
  });
});

describe('projectViewSearch', () => {
  it('adds view=tree and keeps the other parameters', () => {
    expect(projectViewSearch(new URLSearchParams('id=p1&x=1'), 'tree')).toBe('?id=p1&x=1&view=tree');
  });

  it('drops the parameter for the board', () => {
    expect(projectViewSearch(new URLSearchParams('id=p1&view=tree&x=1'), 'board')).toBe('?id=p1&x=1');
  });

  it('does not change the parameters it was given', () => {
    const params = new URLSearchParams('id=p1');
    projectViewSearch(params, 'tree');
    expect(params.toString()).toBe('id=p1');
  });
});
