import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()((theme) => ({
  container: {
    color: 'white',

    [theme.breakpoints.down('sm')]: {
      margin: 0,
    },
  },
}));
