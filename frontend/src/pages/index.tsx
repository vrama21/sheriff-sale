import { useState } from 'react';
import { trpc } from '../utils/trpc';
import { SearchFilters } from 'components';
import { Paper } from '@mui/material';
import { useStyles } from './index.style';

const HomePage: React.FC = () => {
  const { classes } = useStyles();
  
  const initialFilterState = {
    county: '',
    city: '',
    saleDate: '',
  };
  const [filters, setFilters] = useState(initialFilterState);

  const { data: cityByCountyMapping } = trpc.useQuery(['constants.getCitiesByCountyMapping']);
  const { data: listings, refetch } = trpc.useQuery(
    ['listing.getListings', { county: filters.county, city: filters.city }],
    {
      enabled: false,
      initialData: [],
    },
  );

  const counties = cityByCountyMapping ? Object.keys(cityByCountyMapping) : [];

  const onFilterReset = () => {
    setFilters(initialFilterState);
  };

  const onFilterChange = (event: React.ChangeEvent<{ name?: string; value: unknown }>) => {
    const { name, value } = event.target;

    if (name) {
      setFilters({ ...filters, [name]: value });
    }

    return null;
  };

  const onFilterSubmit = () => {
    if (filters === initialFilterState) {
      return;
    }

    refetch();
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
      {/* <ListingView listings={listings || []} /> */}
    </Paper>
  );
};

export default HomePage;
