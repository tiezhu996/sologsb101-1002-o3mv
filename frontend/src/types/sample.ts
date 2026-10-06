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
  /**
   * 离散率（%），由 utils/discrete.ts 同窗复核后落库：
   * 同箱各串写入同一个箱级复核离散率；窗内不足 3 串时写入旧口径串级时序离散率。
   */
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

/** 按组串聚合的统计结果，用于离散率榜 */
export interface StringDiscreteStat {
  stringId: string;
  stringCode: string;
  combinerBox: string;
  inverterId: string;
  arrayId: string;
  plantId: string;
  sampleCount: number;
  avgCurrentA: number;
  /** 同窗复核时为窗内归一化电流中位数，否则为旧口径均值 */
  avgNormalizedCurrentA: number;
  discreteRate: number;
  /** 同窗复核时为相对箱内归一化中位数基准的偏差百分比；未复核时沿用旧口径 */
  currentBiasPercent: number;
  level: DiscreteLevel;
  lastSampledAt: string;
  /** 是否走了同窗复核（false = 窗内不足 3 串等原因，保留原判定） */
  reviewed: boolean;
  /** 复核口径说明 / 保留原判定原因（徽标 tooltip、排查榜、处置单初始值共用） */
  reviewReason: string;
  /** 同窗有效串数（含本串） */
  peerStringCount: number;
  /** 本串窗内命中辐照带宽的采集点数 */
  windowPointCount: number;
  /** 箱内窗辐照度中位数（W/m²） */
  windowIrradianceMedian: number;
  /** 辐照带宽下限（W/m²） */
  windowIrradianceLower: number;
  /** 辐照带宽上限（W/m²） */
  windowIrradianceUpper: number;
}

/** 采集时间排序辅助 */
export function compareBySampledAt(a: Sample, b: Sample): number {
  return a.sampledAt.localeCompare(b.sampledAt);
}
