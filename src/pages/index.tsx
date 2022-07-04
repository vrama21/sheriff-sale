import { useState } from 'react';
import { trpc } from '../utils/trpc';
import { SearchFilters, ListingView } from 'components';
import { Listing } from 'types';
import { Paper } from '@material-ui/core';
import { homePageStyles } from './index.style';

const HomePage: React.FC = () => {
  const { data: cityByCountyMapping } = trpc.useQuery(['constants.getCitiesByCountyMapping']);
  const classes = homePageStyles();

  const counties = cityByCountyMapping ? Object.keys(cityByCountyMapping) : [];

  const initialFilterState = {
    county: '',
    city: '',
    saleDate: '',
  };

  const [filters, setFilters] = useState(initialFilterState);
  const [listings, setListings] = useState<Listing[]>([]);

  const onFilterReset = () => {
    setFilters(initialFilterState);
    setListings(listings);
  };

  const onFilterChange = (event: React.ChangeEvent<{ name?: string; value: unknown }>) => {
    const { name, value } = event.target;

    if (name) {
      setFilters({ ...filters, [name]: value });
    }
  };

  const onFilterSubmit = () => {
    if (!listings) {
      return;
    }

    if (filters == initialFilterState) {
      setListings(listings);

      return;
    }

    setListings(listings);
  };

  return (
    <Paper className={classes.root} elevation={0}>
      <div className={classes.header}>
        <div className={classes.title}>
          <h1>Sheriff Sale Scraper</h1>
        </div>
        <div>
          {cityByCountyMapping && (
            <SearchFilters
              counties={counties}
              citiesByCounty={cityByCountyMapping}
              filters={filters}
              onFilterChange={onFilterChange}
              onFilterReset={onFilterReset}
              onFilterSubmit={onFilterSubmit}
              saleDates={[]}
            />
          )}
        </div>
      </div>
      <ListingView listings={listings} />
    </Paper>
  );
};

export default HomePage;
