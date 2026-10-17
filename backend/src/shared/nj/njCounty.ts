export const NJ_COUNTIES = [
  'Atlantic',
  'Bergen',
  'Burlington',
  'Camden',
  'Cape May',
  'Cumberland',
  'Essex',
  'Gloucester',
  'Hudson',
  'Hunterdon',
  'Middlesex',
  'Monmouth',
  'Morris',
  'Ocean',
  'Passaic',
  'Salem',
  'Union',
] as const;

export type NJCounty = (typeof NJ_COUNTIES)[number];
