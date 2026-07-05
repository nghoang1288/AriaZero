import { memo } from 'react';

interface SparklineProps {
  data: number[];
  color: string;
}

const Sparkline = memo(function Sparkline({ data, color }: SparklineProps) {
  if (!data || data.length < 2) {
    return <div className="w-16 h-5 flex items-center justify-center text-[9px] text-text-dim/40 font-mono">- - -</div>;
  }
  const max = Math.max(...data, 1024); // Min ceiling 1KB/s
  const min = 0;
  const width = 64;
  const height = 14;
  const points = data
    .map((val, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((val - min) / (max - min)) * height;
      return `${x},${y}`;
    })
    .join(' ');

  const gradId = `spark-grad-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} className="overflow-visible block">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <polygon
        fill={`url(#${gradId})`}
        points={`0,${height} ${points} ${width},${height}`}
      />
    </svg>
  );
});

export default Sparkline;
