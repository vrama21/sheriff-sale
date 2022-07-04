import { makeStyles } from '@material-ui/core';

export const listingTableStyles = makeStyles((theme) => ({
  tableContainer: {
    border: `solid 3px ${theme.palette.primary.main}`,
    margin: '0 auto',
    maxWidth: '1200px',
  },

  tableHeader: {
    background: theme.palette.grey[500],
    // color: theme.palette.primary.main,
    fontWeight: 'bold',
    minWidth: '70px',
    textAlign: 'center',

    '&:last-child(2)': {
      width: '300px',
    },

    '&:last-child': {
      width: '150px',
    },

    [theme.breakpoints.down('sm')]: {
      fontSize: '1rem',
    },
  },

  tableRow: {
    border: `solid 2px ${theme.palette.primary.main}`,
    lineHeight: 1,
    padding: '10px',
    textAlign: 'center',

    '&:nth-child(odd)': {
      background: theme.palette.grey[700],
    },

    '&:nth-child(even)': {
      background: theme.palette.grey[500],
    },
  },

  tableCell: {
    fontSize: '1rem',
    fontWeight: 'bold',
    textAlign: 'center',
    color: 'black',

    '& a': {
      color: theme.palette.primary.main,
    },

    [theme.breakpoints.down('sm')]: {
      fontSize: '1rem',
    },
  },
}));
