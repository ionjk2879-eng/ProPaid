export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type UsageType = 'BUSINESS' | 'PERSONAL';

export interface Subscription {
  id: number;
  serviceName: string;
  amount: number;
  billingCycle: BillingCycle;
  usageType: UsageType;
  accountingCategory: string | null;
  createdAt: string;
}

export interface SubscriptionInput {
  serviceName: string;
  amount: number;
  billingCycle: BillingCycle;
  usageType: UsageType;
  accountingCategory?: string;
}
