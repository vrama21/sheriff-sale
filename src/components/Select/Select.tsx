import { Select as MUISelect, MenuProps as MenuP } from '@material-ui/core';
import React from 'react';
import { selectStyles } from './Select.styles';

const MenuProps: Partial<MenuP> = {
  anchorOrigin: {
    vertical: 'bottom',
    horizontal: 'left',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
  getContentAnchorEl: null,
};

interface SelectProps {
  className?: string;
  id?: string;
  name: string;
  onChange: (event: React.ChangeEvent<{ name?: string; value: unknown }>, child: React.ReactNode) => void;
  options: JSX.Element[];
  value: string;
  variant?: SelectProps;
}

const Select: React.FC<SelectProps> = ({ className, id, name, onChange, options, value }: SelectProps) => {
  const classes = selectStyles();

  return (
    <>
      <MUISelect
        children={options}
        className={className || classes.selectRoot}
        onChange={onChange}
        id={id}
        MenuProps={MenuProps}
        name={name}
        value={value}
        variant="outlined"
      />
    </>
  );
};

export default Select;
