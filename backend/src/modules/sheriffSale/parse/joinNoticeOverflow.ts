// Real parcels are short: on 2026-10-18 the longest outside Burlington was 180 characters (Camden). A longer parcel is
// notice text that ran out of room in the description.
export const MAX_PARCEL_LENGTH = 300;

// Civilview caps Burlington's notice fields at about 2,000 characters, and the sheriff's office splits a longer notice
// between words, so a description that overflowed ends close to the cap: 1,900 to 2,000 characters on 2026-10-18. The
// margin below that allows for an earlier split; a description further from the cap wasn't cut by it.
export const MIN_CAPPED_DESCRIPTION_LENGTH = 1800;

/**
 * Civilview caps a notice field at about 2,000 characters, so Burlington's sheriff's office pastes the rest of a long
 * notice into the next fields in page order: Description, then Parcel #, then Property Note. When the parcel is too
 * long to be one and the description is at the cap, joins the three back into the description, leaving no parcel or
 * property note. Any other listing is returned unchanged.
 */
export const joinNoticeOverflow = (listing: Record<string, string>): Record<string, string> => {
  const { description = '', parcel = '', propertyNote = '', ...fields } = listing;

  if (parcel.length <= MAX_PARCEL_LENGTH || description.length < MIN_CAPPED_DESCRIPTION_LENGTH) {
    return listing;
  }

  return { ...fields, description: [description, parcel, propertyNote].filter((part) => part).join(' ') };
};
