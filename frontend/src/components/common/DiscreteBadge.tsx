/**
 * <DiscreteBadge> 离散率档位徽标
 * 按离散率区间渲染正常 / 关注 / 失配三档底色，被采集页与失配排查工作台消费。
 * 同窗复核成功时按复核档位展示并在 tooltip 内附口径；窗内不足 3 串保留原判定时
 * 追加「原判定」小标，并在 tooltip 内说明保留原因。
 */
import { Tag, Tooltip } from 'antd';
import { DISCRETE_BG, DISCRETE_COLOR } from '../../utils/discrete';
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '../../types/settings';
import { DISCRETE_LEVEL_LABEL, type DiscreteLevel } from '../../types/sample';
import { formatPercent } from '../../utils/unit';

export interface DiscreteBadgeProps {
  /** 离散率（%） */
  rate: number;
  /** 判定阈值，缺省用系统默认阈值 */
  thresholds?: ThresholdConfig;
  /** 是否展示数值文本 */
  showValue?: boolean;
  /** 电流偏差（%），展示时附带 */
  biasPercent?: number;
  /** 采集点数（旧口径提示用） */
  sampleCount?: number;
  /** 是否走了同窗复核：false/undefined 时若有 reviewReason 则按「保留原判定」展示 */
  reviewed?: boolean;
  /** 复核口径说明 / 保留原判定原因 */
  reviewReason?: string;
  /** 同窗有效串数 */
  peerStringCount?: number;
  /** 本串窗内命中点数 */
  windowPointCount?: number;
  size?: 'small' | 'default';
}

/** 依据阈值给档位 */
export function levelOfRate(rate: number, thresholds: ThresholdConfig = DEFAULT_THRESHOLDS): DiscreteLevel {
  if (rate >= thresholds.discreteAlarmRate) return 'mismatch';
  if (rate >= thresholds.discreteWatchRate) return 'watch';
  return 'normal';
}

export default function DiscreteBadge({
  rate,
  thresholds = DEFAULT_THRESHOLDS,
  showValue = true,
  biasPercent,
  sampleCount,
  reviewed,
  reviewReason,
  peerStringCount,
  windowPointCount,
  size = 'default',
}: DiscreteBadgeProps) {
  const level = levelOfRate(rate, thresholds);
  const label = DISCRETE_LEVEL_LABEL[level];
  const keptOriginal = reviewed === false && Boolean(reviewReason);
  const tooltip = [
    `离散率 ${rate.toFixed(2)}%（关注 ≥ ${thresholds.discreteWatchRate}%，失配 ≥ ${thresholds.discreteAlarmRate}%）`,
    typeof biasPercent === 'number' ? `电流偏差 ${formatPercent(biasPercent, 2, true)}` : '',
    typeof peerStringCount === 'number' && peerStringCount > 0 ? `同窗有效串数 ${peerStringCount}` : '',
    typeof windowPointCount === 'number' && windowPointCount > 0 ? `本串窗内点数 ${windowPointCount}` : '',
    typeof sampleCount === 'number' ? `累计采集点数 ${sampleCount}` : '',
    reviewReason ? (reviewed ? `同窗复核：${reviewReason.includes('同窗复核：') ? reviewReason.slice('同窗复核：'.length) : reviewReason}` : reviewReason) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip title={tooltip}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Tag
          color={DISCRETE_COLOR[level]}
          style={{
            background: DISCRETE_BG[level],
            borderColor: DISCRETE_COLOR[level],
            color: DISCRETE_COLOR[level],
            fontWeight: level === 'mismatch' ? 600 : 400,
            marginInlineEnd: 0,
            fontSize: size === 'small' ? 12 : 13,
          }}
        >
          {showValue ? `${label} ${rate.toFixed(2)}%` : label}
          {!reviewed && typeof sampleCount === 'number' && sampleCount < thresholds.minSampleCount
            ? '（点数不足）'
            : ''}
        </Tag>
        {reviewed ? (
          <Tag
            color="blue"
            style={{ marginInlineEnd: 0, fontSize: size === 'small' ? 11 : 12, lineHeight: '18px', padding: '0 4px' }}
          >
            同窗复核
          </Tag>
        ) : null}
        {keptOriginal ? (
          <Tag
            color="default"
            style={{ marginInlineEnd: 0, fontSize: size === 'small' ? 11 : 12, lineHeight: '18px', padding: '0 4px' }}
          >
            原判定
          </Tag>
        ) : null}
      </span>
    </Tooltip>
  );
}
