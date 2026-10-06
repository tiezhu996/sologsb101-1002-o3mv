import type { Revisioned } from './persistence';

/** 组串采集读数 */
export interface Sample {
  id: string;
  /** 所属组串 */
  stringId: string;
  /** 采集时间 yyyy-MM-dd HH:mm */
  sampledAt: string;
  /** 电流（A） */
  currentA: number;
  /** 电压（V） */
  voltageV: number;
  /** 辐照度（W/m²） */
  irradianceWm2: number;
  /** 离散率（%），由 utils/discrete.ts 计算后落库 */
  discreteRate: number;
  createdAt: string;
}

/** 录入采集读数的表单草稿（离散率由系统计算） */
export interface SampleDraft {
  stringId: string;
  sampledAt: string;
  currentA: number;
  voltageV: number;
  irradianceWm2: number;
}

/** 离散率档位 */
export type DiscreteLevel = 'normal' | 'watch' | 'mismatch';

export const DISCRETE_LEVEL_LABEL: Record<DiscreteLevel, string> = {
  normal: '正常',
  watch: '关注',
  mismatch: '失配',
};

/** 采集行数据（带组串与设备上下文） */
export interface SampleRow extends Sample, Revisioned {
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  inverterModel: string;
  arrayId: string;
  arrayCode: string;
  plantId: string;
  plantName: string;
  /** 辐照度归一化后的电流（折算到 1000 W/m²） */
  normalizedCurrentA: number;
}

/** 按组串聚合的统计结果，用于离散率榜（同窗复核口径，见 utils/discrete.ts） */
export interface StringDiscreteStat {
  stringId: string;
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  arrayId: string;
  plantId: string;
  sampleCount: number;
  avgCurrentA: number;
  /** 同窗代表电流（A）：复核窗内归一化电流取中位数；未复核时取均值（原判定口径） */
  avgNormalizedCurrentA: number;
  discreteRate: number;
  /** 相对基准（复核箱内中位数 / 未复核全局均值）的偏差百分比 */
  currentBiasPercent: number;
  level: DiscreteLevel;
  lastSampledAt: string;
  /** 复核窗内采集点数（每串最近 8 条） */
  windowCount: number;
  /** 辐照度过滤后保留的点数（箱内中位数 ±15% 以内） */
  keptCount: number;
  /** 箱内窗点辐照度中位数（W/m²） */
  medianIrradiance: number;
  /** 偏差基准电流（A）：复核箱为箱内中位数，未复核为全局均值 */
  baselineA: number;
  /** 是否完成同窗复核（窗内有效组串 ≥ 3 且本串有保留点） */
  reviewed: boolean;
  /** 未复核原因（保留原判定的说明，已复核为空串） */
  reviewNote: string;
}

/** 采集时间排序辅助 */
export function compareBySampledAt(a: Sample, b: Sample): number {
  return a.sampledAt.localeCompare(b.sampledAt);
}
