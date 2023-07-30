import { StatusHistory } from 'database';
import { BaseModel } from './baseModel';

export interface StatusHistoryPropertiesToOmit extends BaseModel {
  listingId: string;
}

export type StatusHistoryParse = Omit<StatusHistory, keyof StatusHistoryPropertiesToOmit>;
