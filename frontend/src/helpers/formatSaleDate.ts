/** `YYYY-MM-DD` to `M/D/YYYY`, by splitting the string: a `Date` would shift a day in US time zones. */
export const formatSaleDate = (saleDate: string | null): string => {
  if (!saleDate) {
    return '-';
  }

  const [year, month, day] = saleDate.split('-');

  return `${Number(month)}/${Number(day)}/${year}`;
};
