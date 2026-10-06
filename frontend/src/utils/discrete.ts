/**
 * 离散率计算与判定（同窗复核口径）
 * 复核窗：每串取最近 8 条采集，剔除辐照度偏离箱内中位数 ±15% 的云影点；
 * 组串代表值与箱内基准均取中位数（不用算术均值），避免离群串把正常串推成失配；
 * 窗内有效组串不足 3 串时保留原判定（均值口径 + 全局基准）并注明原因。
 * 纯函数，供采集页、排查工作台与处置单页共用。
 */
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '../types/settings';
import type { DiscreteLevel, Sample, StringDiscreteStat } from '../types/sample';
import { round } from './format';

/** 同窗复核：每串参与计算的最近采集条数 */
export const REVIEW_WINDOW_SIZE = 8;
/** 同窗复核：保留辐照度在箱内中位数 ±15% 以内的采集点 */
export const IRRADIANCE_BAND_PERCENT = 15;
/** 同窗复核：窗内有效组串不足该数时保留原判定 */
export const MIN_REVIEW_STRINGS = 3;

/** 均值 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 中位数 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 样本标准差（n-1），样本数 < 2 时返回 0 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 离散率（%）= 标准差 / 均值 × 100（原判定口径，未复核时沿用） */
export function discreteRate(values: number[]): number {
  const avg = mean(values);
  if (avg <= 0) return 0;
  return round((stdDev(values) / avg) * 100, 2);
}

/** 离散率（%）= 标准差 / 中位数 × 100（同窗复核口径，离群点不抬高基准） */
export function discreteRateMedian(values: number[]): number {
  const mid = median(values);
  if (mid <= 0) return 0;
  return round((stdDev(values) / mid) * 100, 2);
}

/** 电流归一化修正：把实测电流折算到标准辐照度下，消除云影/时段影响 */
export function normalizeCurrent(
  currentA: number,
  irradianceWm2: number,
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): number {
  if (irradianceWm2 <= 0) return round(currentA, 3);
  const ratio = config.standardIrradiance / irradianceWm2;
  // 辐照度极低时归一化会放大噪声，限制修正倍数上限为 2
  return round(currentA * Math.min(ratio, 2), 3);
}

/** 离散率档位判定 */
export function levelOf(rate: number, config: ThresholdConfig = DEFAULT_THRESHOLDS): DiscreteLevel {
  if (rate >= config.discreteAlarmRate) return 'mismatch';
  if (rate >= config.discreteWatchRate) return 'watch';
  return 'normal';
}

/** 电流偏差百分比：相对基准值（同窗复核取箱内中位数）的偏离 */
export function currentBiasPercent(value: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return round(((value - baseline) / baseline) * 100, 2);
}

/** 分组键：同一逆变器 + 同一汇流箱视为一个可比对集合 */
export function groupKeyOf(row: { inverterId: string; combinerBox: string }): string {
  return `${row.inverterId}::${row.combinerBox}`;
}

/** 组串的汇流箱归属（同窗复核分箱用） */
export interface StringBoxRef {
  id: string;
  inverterId: string;
  combinerBox: string;
}

/** 单串复核窗草稿：最近 8 条 + 辐照度过滤后的保留点 */
interface WindowDraft {
  stringId: string;
  boxKey: string;
  window: Sample[];
  kept: Sample[];
  keptNormalized: number[];
  keptRaws: number[];
  allNormalized: number[];
  allRaws: number[];
  lastSampledAt: string;
  count: number;
}

/**
 * 由采集记录聚合出组串离散率榜（同窗复核）。
 * 同一汇流箱内的组串互为基准：每串最近 8 条为窗，窗内辐照度偏离箱内中位数
 * ±15% 的点视为云影剔除；串代表值与箱基准均取中位数；窗内有效组串不足
 * 3 串（或本串窗点全被过滤）时保留原判定并在 reviewNote 说明原因。
 */
export function buildStringStats(
  samples: Sample[],
  strings: StringBoxRef[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): StringDiscreteStat[] {
  const boxOf = new Map(strings.map((item) => [item.id, groupKeyOf(item)] as const));

  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.stringId);
    if (list) list.push(sample);
    else grouped.set(sample.stringId, [sample]);
  }

  // 每串取最近 8 条组成复核窗
  const drafts: WindowDraft[] = [];
  for (const [stringId, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    const window = sorted.slice(-REVIEW_WINDOW_SIZE);
    drafts.push({
      stringId,
      boxKey: boxOf.get(stringId) ?? `__unknown::${stringId}`,
      window,
      kept: [],
      keptNormalized: [],
      keptRaws: [],
      allNormalized: window.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2, config)),
      allRaws: window.map((item) => item.currentA),
      lastSampledAt: sorted[sorted.length - 1]?.sampledAt ?? '',
      count: list.length,
    });
  }

  const boxWindows = new Map<string, WindowDraft[]>();
  for (const draft of drafts) {
    const list = boxWindows.get(draft.boxKey);
    if (list) list.push(draft);
    else boxWindows.set(draft.boxKey, [draft]);
  }

  // 箱内辐照度中位数 → 云影过滤带（中位数 ±15%）
  const band = IRRADIANCE_BAND_PERCENT / 100;
  const medianIrrOf = new Map<string, number>();
  for (const [key, list] of boxWindows) {
    const irradiances = list.flatMap((draft) => draft.window.map((item) => item.irradianceWm2));
    const mid = median(irradiances);
    medianIrrOf.set(key, mid);
    for (const draft of list) {
      // 中位数 ≤ 0 说明窗内无有效辐照度，不过滤
      draft.kept =
        mid > 0
          ? draft.window.filter((item) => Math.abs(item.irradianceWm2 - mid) <= mid * band)
          : [...draft.window];
      draft.keptNormalized = draft.kept.map((item) =>
        normalizeCurrent(item.currentA, item.irradianceWm2, config),
      );
      draft.keptRaws = draft.kept.map((item) => item.currentA);
    }
  }

  const stats: StringDiscreteStat[] = [];
  for (const [key, list] of boxWindows) {
    const validCount = list.filter((draft) => draft.kept.length > 0).length;
    const reviewable = validCount >= MIN_REVIEW_STRINGS;
    const mid = medianIrrOf.get(key) ?? 0;
    // 箱基准：各串窗内代表值（中位数）的中位数，离群串不拖累正常串
    const boxBaseline = reviewable
      ? median(list.filter((draft) => draft.kept.length > 0).map((draft) => median(draft.keptNormalized)))
      : 0;

    for (const draft of list) {
      const reviewed = reviewable && draft.kept.length > 0;
      const values = reviewed ? draft.keptNormalized : draft.allNormalized;
      const raws = reviewed ? draft.keptRaws : draft.allRaws;
      const reviewNote = reviewed
        ? ''
        : draft.kept.length === 0
          ? `本串窗内采集点均在箱内辐照度中位 ±${IRRADIANCE_BAND_PERCENT}% 之外，保留原判定`
          : `窗内有效组串不足 ${MIN_REVIEW_STRINGS} 串（仅 ${validCount} 串），保留原判定`;
      stats.push({
        stringId: draft.stringId,
        stringCode: '',
        combinerBox: '',
        inverterId: '',
        arrayId: '',
        plantId: '',
        sampleCount: draft.count,
        avgCurrentA: round(mean(raws), 2),
        avgNormalizedCurrentA: round(reviewed ? median(values) : mean(values), 3),
        discreteRate: reviewed ? discreteRateMedian(values) : discreteRate(values),
        currentBiasPercent: 0,
        level: 'normal',
        lastSampledAt: draft.lastSampledAt,
        windowCount: draft.window.length,
        keptCount: draft.kept.length,
        medianIrradiance: round(mid, 0),
        baselineA: round(reviewed ? boxBaseline : 0, 3),
        reviewed,
        reviewNote,
      });
    }
  }

  // 偏差与最终档位：复核串相对箱内中位数基准；未复核串沿用原判定的全局均值基准
  const globalBaseline = mean(stats.map((item) => item.avgNormalizedCurrentA));
  for (const stat of stats) {
    if (!stat.reviewed) {
      stat.baselineA = round(
        globalBaseline > 0 ? globalBaseline : stat.avgNormalizedCurrentA,
        3,
      );
    }
    stat.currentBiasPercent = currentBiasPercent(stat.avgNormalizedCurrentA, stat.baselineA);
    const tooFew = stat.sampleCount < config.minSampleCount;
    const badByRate = levelOf(stat.discreteRate, config);
    const badByBias =
      Math.abs(stat.currentBiasPercent) >= config.currentBiasPercent ? 'mismatch' : 'normal';
    const level: DiscreteLevel =
      badByRate === 'mismatch' || badByBias === 'mismatch'
        ? 'mismatch'
        : badByRate === 'watch'
          ? 'watch'
          : tooFew
            ? 'watch'
            : 'normal';
    stat.level = level;
  }

  return stats;
}

/** 离散率 → 颜色（供表格内联样式复用） */
export const DISCRETE_COLOR: Record<DiscreteLevel, string> = {
  normal: '#237804',
  watch: '#d46b08',
  mismatch: '#a8071a',
};

/** 离散率 → 浅底色 */
export const DISCRETE_BG: Record<DiscreteLevel, string> = {
  normal: '#f6ffed',
  watch: '#fff7e6',
  mismatch: '#fff1f0',
};
