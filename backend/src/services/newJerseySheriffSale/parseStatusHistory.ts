import { HTMLElement, parse } from 'node-html-parser';
import { StatusHistoryParse } from '../../types';

const cellText = (cell: HTMLElement) => cell.text.replace(/\s+/g, ' ').trim();

const findStatusHistoryTable = (root: HTMLElement): HTMLElement | undefined => {
  const longTable = root.querySelector('table#longTable');

  if (longTable) {
    return longTable;
  }

  return root.querySelectorAll('table').find((table) => {
    const headers = table.querySelectorAll('th').map(cellText);

    return headers[0] === 'Status' && headers[1] === 'Date';
  });
};

export const parseStatusHistory = (listingDetailHtml: string): StatusHistoryParse[] => {
  const root = parse(listingDetailHtml);

  const statusHistoryTable = findStatusHistoryTable(root);

  if (!statusHistoryTable) {
    throw new Error('Status history layout not recognised: no status history table');
  }

  // The header row has only `th` cells, so rows with `td` cells are the history.
  return statusHistoryTable
    .querySelectorAll('tr')
    .map((row) => row.querySelectorAll('td'))
    .filter((cells) => cells.length >= 2)
    .map(([statusCell, dateCell]) => ({ status: cellText(statusCell), date: cellText(dateCell) }));
};
