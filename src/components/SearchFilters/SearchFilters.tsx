import React from 'react';
import { FormControl, MenuItem } from '@material-ui/core';

import { ButtonSubmit, FilterLabel, Select } from '..';
import { Filter } from '../../types';
import { searchFiltersStyles } from './SearchFilters.style';

export interface SearchFiltersProps {
  counties: string[];
  citiesByCounty: { [index: string]: { cities: string[] } };
  filters: Filter;
  onFilterChange: (
    event: React.ChangeEvent<{
      name?: string;
      value: unknown;
    }>,
    child: React.ReactNode,
  ) => void;
  onFilterReset: (event: React.FormEvent<Element>) => void;
  onFilterSubmit: (event: React.FormEvent<Element>) => void;
  saleDates: string[];
}

const SearchFilters: React.FC<SearchFiltersProps> = ({
  counties,
  citiesByCounty,
  filters,
  onFilterChange,
  onFilterReset,
  onFilterSubmit,
  saleDates,
}: SearchFiltersProps) => {
  const classes = searchFiltersStyles();

  const selectedCounty = filters.county;
  const selectedCity = filters.city;
  const selectedSaleDate = filters.saleDate;

  const citiesOfSelectedCounty = citiesByCounty?.[selectedCounty]?.cities || [];

  const countyMenuItems = counties?.map((county) => (
    <MenuItem key={`county-${county}`} value={county}>
      {county}
    </MenuItem>
  ));

  const cityMenuItems = citiesOfSelectedCounty?.map((city) => (
    <MenuItem key={`city-${city}`} value={city}>
      {city}
    </MenuItem>
  ));

  const saleDateMenuItems = saleDates?.map((saleDate) => (
    <MenuItem key={`saleDate-${saleDate}`} value={saleDate}>
      {saleDate}
    </MenuItem>
  ));

  return (
    <div>
      <div className={classes.filterContainer}>
        <FormControl className={classes.filterSelect}>
          <FilterLabel id="county-select-label" value="County" />
          <Select
            options={countyMenuItems}
            id="county-select"
            name="county"
            onChange={onFilterChange}
            value={selectedCounty || ''}
          />
        </FormControl>
        <FormControl className={classes.filterSelect}>
          <FilterLabel id="city-select-label" value="City" />
          <Select
            options={cityMenuItems}
            id="city-select"
            name="city"
            onChange={onFilterChange}
            value={selectedCity || ''}
          />
        </FormControl>
        <FormControl className={classes.filterSelect}>
          <FilterLabel id="sale-date-select-label" value="Sale Date" />
          <Select
            options={saleDateMenuItems}
            id="sale-date-select"
            name="saleDate"
            onChange={onFilterChange}
            value={selectedSaleDate || ''}
          />
        </FormControl>
      </div>

      <div>
        <ButtonSubmit name="submit" onClick={onFilterSubmit} value="Submit" />
        <ButtonSubmit name="reset" onClick={onFilterReset} value="Reset" />
      </div>
    </div>
  );
};

export default SearchFilters;
