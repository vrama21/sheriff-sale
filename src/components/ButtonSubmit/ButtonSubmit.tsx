import React from 'react';
import { Button, ButtonProps } from '@material-ui/core';

import { buttonSubmitStyles } from './ButtonSubmit.styles';

interface ButtonSubmitProps extends ButtonProps {
  name?: 'root' | 'submit' | 'reset';
  value: string;
}

const ButtonSubmit: React.FC<ButtonSubmitProps> = ({ name, onClick, size, variant, value }) => {
  const classes = buttonSubmitStyles();

  const className = name ? `${classes.root} ${classes[name]}` : classes.root;

  return (
    <Button className={className} color="primary" onClick={onClick} size={size || 'large'} variant={variant || 'contained'}>
      {value}
    </Button>
  );
};

export default ButtonSubmit;
