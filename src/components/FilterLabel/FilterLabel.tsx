import React from 'react';
import { InputLabel } from '@material-ui/core';
import { filterLabelStyles } from './FilterLabel.styles';

interface FilterLabelProps {
  id?: string;
  value: string;
}

const FilterLabel: React.FC<FilterLabelProps> = ({ id, value }) => {
  const classes = filterLabelStyles();

  return (
    <>
      <InputLabel className={classes.filterLabelRoot} id={id}>
        {value}
      </InputLabel>
    </>
  );
};

export default FilterLabel;
