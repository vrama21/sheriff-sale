import { StatusHistory } from '@sheriff-sale/database';
import { BaseModel } from './baseModel';

export interface StatusHistoryPropertiesToOmit extends BaseModel {
  firstSeenOn: string;
  lastSeenOn: string;
  listingId: string;
}

export type StatusHistoryParse = Omit<StatusHistory, keyof StatusHistoryPropertiesToOmit>;
