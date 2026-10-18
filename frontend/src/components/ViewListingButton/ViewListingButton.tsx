import Link from 'next/link';
import { useStyles } from './ViewListingButton.styles';
import { ButtonSubmit } from '../../components';

const ViewListingButton = ({ listingId }: { listingId: string }) => {
  const { classes } = useStyles();

  return (
    <>
      <Link href={`listing/${listingId}`}>
        <ButtonSubmit className={classes.viewListingButtonRoot} value="View Listing" />
      </Link>
    </>
  );
};

export default ViewListingButton;
