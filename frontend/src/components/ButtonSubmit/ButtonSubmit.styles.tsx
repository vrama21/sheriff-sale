import { makeStyles } from '@material-ui/core';

export const buttonSubmitStyles = makeStyles((theme) => ({
  root: {
    margin: '0 0.5rem',
  },
  reset: {
    backgroundColor: theme.palette.warning.dark,

    '&:hover': {
      backgroundColor: theme.palette.warning.main,
    },
  },
  submit: {
    backgroundColor: theme.palette.success.dark,

    '&:hover': {
      backgroundColor: theme.palette.success.main,
    },
  },
}));
