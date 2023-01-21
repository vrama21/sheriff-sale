import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()((theme) => ({
  filterContainer: {
    margin: '1rem',
  },
  filterSelect: {
    backgroundColor: theme.palette.primary.light,
    margin: '0 0.5rem',
    width: 225,
  },
}));
