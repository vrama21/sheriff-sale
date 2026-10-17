/* eslint-disable react/jsx-key */
import React, { useMemo } from 'react';
import { CellProps, Column, useTable } from 'react-table';
import { Table, TableBody, TableHead, TableRow, TableCell, useMediaQuery } from '@mui/material';
import { Listing } from '@sheriff-sale/database';
import { formatSaleDate, formatToCurrency } from '../../helpers';
import { ViewListingButton } from '../../components';
import { useStyles } from './ListingTable.styles';

interface ListingTableProps {
  listings: Listing[];
}

// A judgment, when the listing has one, else the upset amount.
const AmountCell = ({ row }: CellProps<Listing>) => {
  const value = row.original.judgment ?? row.original.upsetAmount;

  return <span>{value != null ? formatToCurrency(value) : '-'}</span>;
};

const ListingTable: React.FC<ListingTableProps> = ({ listings }: ListingTableProps) => {
  const { classes } = useStyles();
  const mobileView = useMediaQuery('(min-width: 0px)', { noSsr: true });

  const columnHeaders: Column<Listing>[] = mobileView
    ? [
        {
          Header: 'Address',
          accessor: 'address',
        },
        {
          Header: 'Upset ',
          accessor: 'upsetAmount',
          Cell: AmountCell,
        },
      ]
    : [
        {
          Header: 'Address',
          accessor: 'address',
        },
        {
          Header: 'County',
          accessor: 'county',
        },
        {
          Header: 'Sale Date',
          accessor: 'saleDate',
          Cell(cellProps) {
            return <span>{formatSaleDate(cellProps.row.original.saleDate)}</span>;
          },
        },
        {
          Header: 'Attorney',
          accessor: 'attorney',
        },
        {
          Header: 'Upset Amount',
          accessor: 'upsetAmount',
          Cell: AmountCell,
        },
        {
          Header: 'Link',
          accessor: 'id',
          Cell(cellProps) {
            return <ViewListingButton listingId={cellProps.cell.value.toString()} />;
          },
        },
      ];

  const data = useMemo(
    () =>
      listings.map((listing) => ({
        address: listing.address,
        attorney: listing.attorney,
        county: listing.county,
        defendant: listing.defendant,
        judgment: listing.judgment,
        saleDate: listing.saleDate,
        upsetAmount: listing.upsetAmount,
        id: listing.id,
      })),
    [listings],
  );

  const columns = useMemo(() => columnHeaders, [mobileView]);

  // @ts-ignore
  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = useTable({ columns, data });

  const tableHeaders = headerGroups.map((headerGroup) => {
    return (
      <TableRow {...headerGroup.getHeaderGroupProps()}>
        {headerGroup.headers.map((column, i) => (
          <TableCell key={`column-${i}`} className={classes.tableHeader} {...column.getHeaderProps()}>
            {column.render('Header')}
          </TableCell>
        ))}
      </TableRow>
    );
  });

  const tableRows = rows.map((row) => {
    prepareRow(row);

    return (
      <TableRow className={classes.tableRow} {...row.getRowProps()}>
        {row.cells.map((cell) => (
          <TableCell className={classes.tableCell} {...cell.getCellProps()}>
            {cell.render('Cell')}
          </TableCell>
        ))}
      </TableRow>
    );
  });

  return (
    <Table className={classes.tableContainer} stickyHeader={true} {...getTableProps()}>
      <TableHead>{tableHeaders}</TableHead>
      <TableBody {...getTableBodyProps()}>{tableRows}</TableBody>
    </Table>
  );
};

export default ListingTable;
