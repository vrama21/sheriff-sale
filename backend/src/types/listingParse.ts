import { Listing, StatusHistory } from 'database';
import { BaseModel } from './baseModel';

export interface ListingPropertiesToOmit extends BaseModel {
  statusHistory: StatusHistory[];
}

export type ListingParse = Omit<Listing, keyof ListingPropertiesToOmit>;
