import { join } from 'node:path';
import { homedir } from 'node:os';

const STATE_HOME_ENV = 'EVE_STATE_HOME';

export function getEveStateHome(): string {
  return process.env[STATE_HOME_ENV] || join(homedir(), '.local', 'share', 'eve');
}

export function getEveStatePath(): string {
  return join(getEveStateHome(), 'state.json');
}

export function getEveEventsPath(): string {
  return join(getEveStateHome(), 'events.jsonl');
}
