import Link from 'next/link';
import { viewListingButtonStyles } from './ViewListingButton.styles';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import { ButtonSubmit } from 'components';

const ViewListingButton: React.FC<{ listingId: number }> = ({ listingId }: { listingId: number }) => {
  const classes = viewListingButtonStyles();

  return (
    <>
      <Link href={`listing/${listingId}`}>
        <ButtonSubmit className={classes.viewListingButtonRoot} value="View Listing">
          <ArrowForwardIcon />
        </ButtonSubmit>
      </Link>
    </>
  );
};

export default ViewListingButton;
