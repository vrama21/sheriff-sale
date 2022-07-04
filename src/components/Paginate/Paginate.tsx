import React, { useContext } from 'react';
import ReactPaginate from 'react-paginate';
import { useAppContext } from 'contexts';
import { paginateStyles } from './Paginate.style';

interface PaginateProps {
  pageCount: number;
}

const Paginate: React.FC<PaginateProps> = ({ pageCount }: PaginateProps) => {
  const { appContext, setAppContext } = useAppContext();
  const { currentPage } = appContext;

  const handlePageClick: (selectedItem: { selected: number }) => void = (selectedItem) => {
    setAppContext({ currentPage: selectedItem.selected + 1 });
  };

  const classes = paginateStyles();

  if (currentPage === 0) {
    return null;
  }

  return (
    <ReactPaginate
      previousLabel="<"
      previousLinkClassName={classes.linkStyle}
      nextLabel=">"
      nextLinkClassName={classes.linkStyle}
      breakLabel="..."
      breakClassName={classes.basicStyle}
      breakLinkClassName={classes.linkStyle}
      containerClassName={classes.containerStyle}
      initialPage={0}
      pageCount={pageCount}
      marginPagesDisplayed={4}
      nextClassName={classes.basicStyle}
      pageClassName={classes.basicStyle}
      pageLinkClassName={classes.linkStyle}
      pageRangeDisplayed={3}
      previousClassName={classes.basicStyle}
      onPageChange={handlePageClick}
      activeLinkClassName={classes.activeLinkStyle}
    />
  );
};

export default Paginate;
