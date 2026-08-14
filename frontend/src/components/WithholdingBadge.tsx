import { calcWithholding, formatKRW } from '../utils/tax';

interface WithholdingBadgeProps {
  amount: number;
}

export default function WithholdingBadge({ amount }: WithholdingBadgeProps) {
  const { tax, net } = calcWithholding(amount);
  return (
    <span className="withholding-badge" title={`원천세(3.3%) ${formatKRW(tax)} 차감 기준 계산기 값입니다. 실제 세액은 세무사와 확인하세요.`}>
      실수령 약 {formatKRW(net)}
      <span className="withholding-tax">원천세 {formatKRW(tax)}</span>
    </span>
  );
}
