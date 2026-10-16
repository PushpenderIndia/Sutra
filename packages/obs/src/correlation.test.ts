import { describe, expect, it } from 'vitest';
import { currentCorrelation, withCorrelation } from './correlation.ts';

describe('correlation', () => {
  it('is empty outside any scope', () => {
    expect(currentCorrelation()).toEqual({});
  });

  it('exposes the ids in scope', () => {
    withCorrelation({ workspaceId: 'ws', runId: 'r1' }, () => {
      expect(currentCorrelation()).toEqual({ workspaceId: 'ws', runId: 'r1' });
    });
  });

  it('merges nested scopes additively without losing parent ids', () => {
    withCorrelation({ workspaceId: 'ws', runId: 'r1' }, () => {
      withCorrelation({ nodeId: 'profiler', contactId: 'c1' }, () => {
        expect(currentCorrelation()).toEqual({
          workspaceId: 'ws',
          runId: 'r1',
          nodeId: 'profiler',
          contactId: 'c1',
        });
      });
      // The child scope does not leak back out.
      expect(currentCorrelation()).toEqual({ workspaceId: 'ws', runId: 'r1' });
    });
  });

  it('ignores undefined keys so a child never blanks a parent id', () => {
    withCorrelation({ workspaceId: 'ws' }, () => {
      withCorrelation({ workspaceId: undefined, nodeId: 'n' }, () => {
        expect(currentCorrelation()).toEqual({ workspaceId: 'ws', nodeId: 'n' });
      });
    });
  });
});
