import React, { useMemo } from 'react';
import { Column, useTable } from 'react-table';
import { Table, TableBody, TableHead, TableRow, TableCell, useMediaQuery } from '@mui/material';
import { Listing } from '@prisma/client';
import { formatToCurrency } from 'helpers';
import { ViewListingButton } from 'components';
import { useStyles } from './ListingTable.styles';

interface ListingTableProps {
  listings: Listing[];
}

const ListingTable: React.FC<ListingTableProps> = ({ listings }: ListingTableProps) => {
  const { classes } = useStyles();
  const mobileView = useMediaQuery('(min-width: 0px)', { noSsr: true });

  const columnHeaders:  Column<Listing>[] = mobileView
    ? [
        {
          Header: 'Address',
          accessor: 'address',
        },
        {
          Header: 'Upset ',
          accessor: 'upsetAmount',
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
        },
        {
          Header: 'Attorney',
          accessor: 'attorney',
        },
        {
          Header: 'Upset Amount',
          accessor: 'upsetAmount',
          Cell(cellProps) {
            const rowData = cellProps.row.original;

            const value = rowData.judgment || rowData.upsetAmount;

            return <span>{value ? formatToCurrency(value) : '-'}</span>;
          },
        },
        {
          Header: 'Link',
          accessor: 'id',
          Cell(cellProps) {
            return <ViewListingButton listingId={cellProps.cell.value} />;
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
        saleDate: listing.saleDate,
        id: listing.id,
      })),
    [listings],
  );

  const columns = useMemo(() => columnHeaders, [mobileView]);

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = useTable({ columns, data });

  const tableHeaders = headerGroups.map((headerGroup) => {
    return (
      <TableRow {...headerGroup.getHeaderGroupProps()}>
        {headerGroup.headers.map((column) => (
          <TableCell className={classes.tableHeader} {...column.getHeaderProps()}>
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
