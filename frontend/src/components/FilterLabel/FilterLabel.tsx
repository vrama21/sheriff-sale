import React from 'react';
import { InputLabel } from '@mui/material';
import { useStyles } from './FilterLabel.styles';

interface FilterLabelProps {
  id?: string;
  value: string;
}

const FilterLabel: React.FC<FilterLabelProps> = ({ id, value }) => {
  const { classes } = useStyles();

  return (
    <>
      <InputLabel className={classes.filterLabelRoot} id={id}>
        {value}
      </InputLabel>
    </>
  );
};

export default FilterLabel;
