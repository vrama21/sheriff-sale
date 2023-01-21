import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()((theme) => ({
  root: {
    textAlign: 'center',
  },
  header: {
    background: theme.palette.common.black,
    paddingBottom: '2rem',
  },
  title: {
    padding: '0.5rem 0',
  },
}));
