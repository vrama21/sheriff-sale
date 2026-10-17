import { DateTime } from 'luxon';
import { NJ_COUNTIES, NJCounty } from '../../../shared/nj';

export const USAGE =
  'Usage: npm run replay:archive -- [--county <name>]... --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--dry-run]';

export interface ReplayArgs {
  /** In NJ_COUNTIES order; every county when none was given. */
  counties: NJCounty[];
  /** Every day from --from through --to, earliest first. */
  dates: string[];
  dryRun: boolean;
}

// "cape may", "Cape-May" and "CAPE MAY" all name Cape May.
const countyKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ' ');
const countiesByKey = new Map(NJ_COUNTIES.map((county) => [countyKey(county), county]));

const parseDate = (flag: string, value: string | undefined): DateTime => {
  const date = value ? DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'utc' }) : undefined;

  if (!date?.isValid) {
    throw new Error(`${flag} must be a date as YYYY-MM-DD, got ${value === undefined ? 'nothing' : `"${value}"`}`);
  }

  return date;
};

/** Parses the command's arguments, throwing on anything it can't replay before a single page is read. */
export const parseReplayArgs = (argv: string[]): ReplayArgs => {
  const requestedCounties = new Set<NJCounty>();
  let from: string | undefined;
  let to: string | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const next = inlineValue ?? argv[++i];

      if (next === undefined || (inlineValue === undefined && next.startsWith('--'))) {
        throw new Error(`${flag} needs a value`);
      }

      return next;
    };

    switch (flag) {
      case '--county': {
        const name = value();
        const county = countiesByKey.get(countyKey(name));

        if (!county) {
          throw new Error(`Unknown county "${name}". Expected one of: ${NJ_COUNTIES.join(', ')}`);
        }

        requestedCounties.add(county);
        break;
      }
      case '--from':
        from = value();
        break;
      case '--to':
        to = value();
        break;
      case '--dry-run':
        if (inlineValue !== undefined) {
          throw new Error('--dry-run takes no value');
        }

        dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument "${argv[i]}"`);
    }
  }

  const fromDate = parseDate('--from', from);
  const toDate = parseDate('--to', to);

  if (fromDate > toDate) {
    throw new Error(`--from ${from} is after --to ${to}`);
  }

  const dates: string[] = [];

  for (let date = fromDate; date <= toDate; date = date.plus({ days: 1 })) {
    dates.push(date.toISODate());
  }

  return {
    counties:
      requestedCounties.size > 0 ? NJ_COUNTIES.filter((county) => requestedCounties.has(county)) : [...NJ_COUNTIES],
    dates,
    dryRun,
  };
};
