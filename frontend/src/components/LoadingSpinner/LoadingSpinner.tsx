import React from 'react';
import { ReactComponent as LoadingSVG } from 'assets/loading_spinner.svg';
import { useStyles } from './LoadingSpinner.style';

const LoadingSpinner: React.FC = () => {
  const { classes } = useStyles();

  return (
    <div className={classes.root}>
      <LoadingSVG />
    </div>
  );
};

export default LoadingSpinner;
