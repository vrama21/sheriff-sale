import { readFileSync } from 'fs';
import { join } from 'path';

export type FixtureCounty = 'essex' | 'passaic' | 'monmouth' | 'burlington';

/** A page captured from a PRESS portal during the spike (design, "Spike findings"), byte for byte. */
export const readPressFixture = (county: FixtureCounty, name: string): string =>
  readFileSync(join(__dirname, 'press', county, `${name}.html`), 'utf8');
