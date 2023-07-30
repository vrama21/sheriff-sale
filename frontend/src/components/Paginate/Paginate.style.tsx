import { makeStyles } from 'tss-react/mui';

export const useStyles = makeStyles()((theme) => ({
  activeLinkStyle: {
    color: theme.palette.primary.main,
    borderBottom: '1px solid',
  },
  basicStyle: {
    display: 'block',
    padding: '0.5rem',
  },
  containerStyle: {
    backgroundColor: theme.palette.secondary.main,
    border: '2px solid',
    borderColor: theme.palette.primary.main,
    borderRadius: '5px',
    boxShadow: `3px 4px ${theme.palette.grey[900]}`,
    display: 'flex',
    justifyContent: 'center',
    margin: '2rem auto',
    padding: '0 1rem',
    width: 'fit-content',
  },
  linkStyle: {
    fontWeight: 'bold',
    outline: 'none',
    ['&:hover']: {
      color: theme.palette.primary.main,
      cursor: 'pointer',
    },
  },
}));
