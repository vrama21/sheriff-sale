const formatToCurrency = (number: number): string => {
  const formattedNumber = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(number);

  return formattedNumber;
};

export { formatToCurrency };
