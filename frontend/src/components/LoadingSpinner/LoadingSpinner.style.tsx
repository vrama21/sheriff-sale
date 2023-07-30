import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()(() => ({
  root: {
    ['& svg']: {
      background: 'transparent',
    },
  },
}));
