import { makeStyles } from '@material-ui/core/styles';

export const listingViewStyles = makeStyles((theme) => ({
  listingViewContainer: {
    paddingBottom: '4rem',
    margin: '0 6rem',

    [theme.breakpoints.down('sm')]: {
      margin: '0.5rem',
    },
  },
}));
