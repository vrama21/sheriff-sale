import { makeStyles } from '@material-ui/core/styles';

export const loadingSpinnerStyles = makeStyles(() => ({
  root: {
    '& svg': {
      background: 'transparent',
    },
  },
}));
