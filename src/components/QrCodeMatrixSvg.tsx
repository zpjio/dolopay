import React, { useMemo } from 'react';
import type { PaymentChannel } from '../core/dolopayEngine';

interface QrCodeMatrixSvgProps {
  payload: string;
  channel: PaymentChannel;
  size?: number;
  expired?: boolean;
}

export const QrCodeMatrixSvg: React.FC<QrCodeMatrixSvgProps> = ({
  payload,
  channel,
  size = 196,
  expired = false,
}) => {
  const gridSize = 25;

  const matrix = useMemo(() => {
    const grid: boolean[][] = Array.from({ length: gridSize }, () =>
      Array(gridSize).fill(false)
    );

    const isFinderArea = (r: number, c: number) => {
      if (r < 8 && c < 8) return true;
      if (r < 8 && c >= gridSize - 8) return true;
      if (r >= gridSize - 8 && c < 8) return true;
      return false;
    };

    const drawFinder = (rowOffset: number, colOffset: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[rowOffset + r][colOffset + c] = isBorder || isInner;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, gridSize - 7);
    drawFinder(gridSize - 7, 0);

    // Timing patterns
    for (let i = 8; i < gridSize - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // Deterministic hash of payload for data modules
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (isFinderArea(r, c) || r === 6 || c === 6) continue;
        // Reserve center 5x5 for channel badge
        if (r >= 10 && r <= 14 && c >= 10 && c <= 14) continue;

        const charCode = payload.charCodeAt((r * gridSize + c) % Math.max(1, payload.length)) || 42;
        const mixed = ((hash ^ (r * 131 + c * 977 + charCode * 31)) >>> 0) % 100;
        grid[r][c] = mixed < 52;
      }
    }

    return grid;
  }, [payload]);

  const badgeColors: Record<PaymentChannel, { bg: string; label: string }> = {
    alipay: { bg: '#2563EB', label: '支' },
    wechat: { bg: '#059669', label: '微' },
    unionpay: { bg: '#E11D48', label: '云' },
  };

  const badge = badgeColors[channel];

  return (
    <div
      className="relative inline-flex items-center justify-center bg-white p-3 rounded-lg border border-slate-200"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${gridSize} ${gridSize}`}
        className={`w-full h-full ${expired ? 'opacity-20 blur-[1px]' : ''}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`${badge.label}收款二维码`}
      >
        {matrix.map((row, rIdx) =>
          row.map((cell, cIdx) =>
            cell ? (
              <rect
                key={`${rIdx}-${cIdx}`}
                x={cIdx}
                y={rIdx}
                width={1}
                height={1}
                fill="#0F172A"
              />
            ) : null
          )
        )}
        {/* Center channel mark */}
        <rect
          x={10}
          y={10}
          width={5}
          height={5}
          rx={0.8}
          fill="#FFFFFF"
        />
        <rect
          x={10.4}
          y={10.4}
          width={4.2}
          height={4.2}
          rx={0.6}
          fill={badge.bg}
        />
        <text
          x={12.5}
          y={13.55}
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="2.7"
          fontWeight="700"
          fontFamily="sans-serif"
        >
          {badge.label}
        </text>
      </svg>

      {expired && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-[1px] rounded-lg p-2 text-center">
          <span className="text-xs font-semibold text-rose-600">二维码已过期释放</span>
          <span className="text-[11px] text-slate-600 mt-0.5">请重新发起收款单</span>
        </div>
      )}
    </div>
  );
};
