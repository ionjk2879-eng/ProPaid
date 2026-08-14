const WITHHOLDING_RATE = 0.033;

export interface WithholdingBreakdown {
  gross: number;
  tax: number;
  net: number;
}

export function calcWithholding(amount: number): WithholdingBreakdown {
  const tax = Math.round(amount * WITHHOLDING_RATE);
  return { gross: amount, tax, net: amount - tax };
}

export function formatKRW(value: number): string {
  return value.toLocaleString('ko-KR') + '원';
}
