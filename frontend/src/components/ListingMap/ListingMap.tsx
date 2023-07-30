import React from 'react';
import { GoogleMap, Marker } from '@react-google-maps/api';
import { useStyles } from './ListingMap.styles';

interface ListingMapProps {
  latitude: number;
  longitude: number;
}

const ListingMap: React.FC<ListingMapProps> = ({ latitude, longitude }) => {
  const { classes } = useStyles();

  const containerStyle = {
    height: 350,
    maxWidth: '400px',
    minWidth: '315px',
  };

  const coordinates = {
    lat: latitude,
    lng: longitude,
  };

  return (
    <div className={classes.mapContainer}>
      <GoogleMap mapContainerStyle={containerStyle} center={coordinates} zoom={17}>
        <Marker position={coordinates}></Marker>
      </GoogleMap>
    </div>
  );
};

export default ListingMap;
