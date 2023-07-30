import { Select as MUISelect, MenuProps as MenuP } from '@mui/material';
import { SelectInputProps } from '@mui/material/Select/SelectInput';
import React from 'react';
import { useStyles } from './Select.styles';

interface SelectProps {
  className?: string;
  id?: string;
  name: string;
  // onChange: (event: React.ChangeEvent<{ name?: string; value: unknown }>, child: React.ReactNode) => void;
  onChange: SelectInputProps['onChange'];
  options: JSX.Element[];
  value: string;
  variant?: SelectProps;
}

const Select: React.FC<SelectProps> = ({ className, id, name, onChange, options, value }: SelectProps) => {
  const { classes } = useStyles();

  return (
    <>
      <MUISelect
        children={options}
        className={className || classes.selectRoot}
        onChange={onChange}
        id={id}
        MenuProps={{
          anchorOrigin: {
            vertical: 'bottom',
            horizontal: 'left',
          },
          transformOrigin: {
            vertical: 'top',
            horizontal: 'left',
          },
        }}
        name={name}
        value={value}
        variant="outlined"
      />
    </>
  );
};

export default Select;
