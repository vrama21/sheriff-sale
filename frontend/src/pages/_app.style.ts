import { makeStyles } from '@material-ui/core';

export const globalStyles = makeStyles((theme) => ({
  container: {
    color: 'white',

    [theme.breakpoints.down('sm')]: {
      margin: 0,
    },
  },
}));
