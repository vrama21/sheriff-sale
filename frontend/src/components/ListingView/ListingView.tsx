import React from 'react';
import { useAppContext } from '../../contexts';
import { ListingTable, Paginate } from '../../components';
import { Listing } from '@prisma/client';
import { useStyles } from './ListingView.styles';

interface ListingViewProps {
  listings: Listing[];
}

const ListingView: React.FC<ListingViewProps> = ({ listings }: ListingViewProps) => {
  const { classes } = useStyles();
  const { appContext } = useAppContext();
  const { currentPage } = appContext;

  const listingsPerPage = 25;
  const indexOfLastBorrower = currentPage * listingsPerPage;
  const indexOfFirstBorrower = indexOfLastBorrower - listingsPerPage;
  const pageCount = listings && Math.ceil(listings.length / listingsPerPage);
  const viewableListings = listings && listings.slice(indexOfFirstBorrower, indexOfLastBorrower);

  return (
    <div className={classes.listingViewContainer}>
      {listings && (
        <div>
          <Paginate pageCount={pageCount} />
          <ListingTable listings={viewableListings} />
        </div>
      )}
      {/* {!listings && <LoadingSpinner />} */}
      {viewableListings?.length === 0 && <span>There are no results with the selected filters.</span>}
    </div>
  );
};

export default ListingView;
