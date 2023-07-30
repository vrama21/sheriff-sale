export const formatToCurrency = (number: number | string): string => {
  if (typeof number === 'string') {
    return `$${parseInt(number).toFixed(2)}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(number);
};
