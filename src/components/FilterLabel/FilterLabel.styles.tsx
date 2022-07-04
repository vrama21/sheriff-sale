import { makeStyles } from '@material-ui/core/styles';

export const filterLabelStyles = makeStyles(() => ({
  filterLabelRoot: {
    color: 'white',
    fontWeight: 'bold',
    paddingLeft: '0.5rem',
    position: 'absolute',
    zIndex: 1,
    top: '-5px',
  },
  focused: {
    color: '#FFF',
    transform: 'translate(0, 5px) scale(0.75)',
  },
}));
