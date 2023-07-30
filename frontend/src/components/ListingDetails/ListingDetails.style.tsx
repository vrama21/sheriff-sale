import { makeStyles } from 'tss-react/mui';

export const useClasses = makeStyles()((theme) => ({
  root: {
    margin: '2rem auto',
    position: 'relative',
    maxWidth: '75%',
    minWidth: '50%',

    [theme.breakpoints.down('sm')]: {
      margin: '0.5rem',
    },
  },
  addressHeader: {
    background: theme.palette.secondary.main,
    borderLeft: '5px',
    borderTop: '5px',
    borderRight: '5px',
    borderStyle: 'solid',
    borderColor: theme.palette.primary.main,
    borderRadius: '0.5rem 0.5rem 0 0',
    color: theme.palette.primary.main,
    fontSize: '22px',
    fontWeight: 'bold',
    padding: '0.5rem 1rem',
    position: 'relative',
  },
  googleMapsLogo: {
    backgroundColor: theme.palette.primary.main,
    borderRadius: '5px',
    bottom: '5px',
    margin: '0 0 0 15px',
    height: 30,
    padding: '0.25rem',
    position: 'absolute',
  },
  listingContainer: {
    background: '#3D405B',
    border: '5px solid',
    borderColor: theme.palette.primary.main,
    borderRadius: '0 0 0.5rem 0.5rem',
    display: 'flex',
    padding: '1rem',
  },
  listingLabel: {
    color: theme.palette.secondary.main,
    display: 'block',
    fontWeight: 'bold',
    marginRight: '10px',
    paddingBottom: '5px',
    textShadow: '1px 1px #000000',
  },
  listingValue: {
    display: 'block',
    paddingBottom: '5px',
    textAlign: 'left',
    marginLeft: '0.25rem',
  },
}));
