import { NJCounty } from '../../types';

/** The county's name in archive keys: `cape-may` in `county-html-files/<date>/cape-may-county.html`. */
export const countySlug = (county: NJCounty): string => county.toLowerCase().replace(/\s+/g, '-');
