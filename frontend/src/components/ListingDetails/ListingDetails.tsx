import React from 'react';
import { Grid } from '@mui/material';
import { formatToCurrency } from 'helpers';
import { ListingMap } from 'components';
import { useClasses } from './ListingDetails.style';
import { Listing } from '@prisma/client';

interface ListingProps {
  listing: Listing;
}

const ListingDetails: React.FC<ListingProps> = ({ listing }) => {
  const { classes } = useClasses();
  const formattedAddress =
    listing.city && listing.street && `${listing.street}, ${listing.city}, ${listing.state} ${listing.zipcode}`;

  return (
    <div className={classes.root}>
      <div className={classes.addressHeader}>{formattedAddress || listing.address}</div>

      <Grid container className={classes.listingContainer}>
        <Grid item xs={5}>
          {listing.latitude && listing.longitude && (
            <ListingMap latitude={parseFloat(listing.latitude)} longitude={parseFloat(listing.longitude)} />
          )}
        </Grid>
        <Grid item xs={3}>
          <div>
            <span className={classes.listingLabel}>Court Case: </span>
            <span className={classes.listingValue}>{listing.courtCase}</span>
          </div>
          <div>
            <span className={classes.listingLabel}>Sale Date: </span>
            <span className={classes.listingValue}>{listing.saleDate}</span>
          </div>
          {listing.judgment && (
            <div>
              <span className={classes.listingLabel}>Judgment: </span>
              <span className={classes.listingValue}>{formatToCurrency(listing.judgment)}</span>
            </div>
          )}
          {listing.upsetAmount && (
            <div>
              <span className={classes.listingLabel}>Upset Amount: </span>
              <span className={classes.listingValue}>{formatToCurrency(listing.upsetAmount)}</span>
            </div>
          )}
        </Grid>
        <Grid item xs={4}>
          <div>
            <span className={classes.listingLabel}>Attorney: </span>
            <span className={classes.listingValue}>{listing.attorney}</span>
          </div>
          {listing.attorneyPhone && (
            <div>
              <span className={classes.listingLabel}>Attorney Phone: </span>
              <span className={classes.listingValue}>{listing.attorneyPhone}</span>
            </div>
          )}
          <div>
            <span className={classes.listingLabel}>Plaintiff: </span>
            <span className={classes.listingValue}>{listing.plaintiff}</span>
          </div>
          <div>
            <span className={classes.listingLabel}>Defendant: </span>
            <span className={classes.listingValue}>{listing.defendant}</span>
          </div>
          <div>
            {listing.priors && <span className={classes.listingLabel}>Priors: </span>}
            <span className={classes.listingValue}>{listing.priors}</span>
          </div>
        </Grid>
      </Grid>
    </div>
  );
};

export default ListingDetails;
