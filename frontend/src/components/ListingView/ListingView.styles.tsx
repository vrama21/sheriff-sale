import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()((theme) => ({
  listingViewContainer: {
    paddingBottom: '4rem',
    margin: '0 6rem',

    [theme.breakpoints.down('sm')]: {
      margin: '0.5rem',
    },
  },
}));
