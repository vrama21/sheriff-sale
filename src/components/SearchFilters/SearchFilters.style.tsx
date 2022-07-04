import { makeStyles } from '@material-ui/core/styles';


export const searchFiltersStyles = makeStyles((theme) => ({
  filterContainer: {
    margin: '1rem',
  },
  filterSelect: {
    backgroundColor: theme.palette.grey[700],
    margin: '0 0.5rem',
    width: 225,
  },
}));