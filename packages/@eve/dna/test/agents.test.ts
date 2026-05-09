import { describe, it, expect } from 'vitest';
import {
  AGENTS,
  agentsToProvision,
  allAgentTypes,
  resolveAgent,
} from '../src/agents.js';

describe('AGENTS registry', () => {
  it('lists the provisionable agent registry in stable order', () => {
    expect(allAgentTypes()).toEqual([
      'eve',
      'openclaw',
      'hermes',
      'coder',
    ]);
  });

  it('flags eve as alwaysProvision (Doctor needs a key on day one)', () => {
    const eve = resolveAgent('eve');
    expect(eve).not.toBeNull();
    expect(eve?.alwaysProvision).toBe(true);
    expect(eve?.componentId).toBeNull();
  });

  it('every non-eve agent points at a real component id', () => {
    const componentBacked = AGENTS.filter((a) => !a.alwaysProvision);
    for (const agent of componentBacked) {
      expect(agent.componentId).not.toBeNull();
      expect(typeof agent.componentId).toBe('string');
    }
  });

  it('resolveAgent returns null for unknown slugs', () => {
    expect(resolveAgent('not-real')).toBeNull();
  });
});

describe('agentsToProvision', () => {
  it('always includes eve, even when no components are installed', () => {
    const result = agentsToProvision([]);
    expect(result.map((a) => a.agentType)).toContain('eve');
  });

  it('skips agents whose component is not installed', () => {
    const result = agentsToProvision([]);
    const slugs = result.map((a) => a.agentType);
    expect(slugs).not.toContain('openclaw');
    expect(slugs).not.toContain('hermes');
  });

  it('includes an agent when its component is installed', () => {
    const result = agentsToProvision(['openclaw']);
    const slugs = result.map((a) => a.agentType);
    expect(slugs).toContain('eve');
    expect(slugs).toContain('openclaw');
    expect(slugs).not.toContain('hermes');
  });
});
