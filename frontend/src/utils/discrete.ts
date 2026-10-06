/**
 * 离散率计算与判定
 * 离散率 = 标准差 / 基准 × 100%，衡量同一汇流箱内组串电流的一致性。
 *
 * 云影会让同汇流箱不同组串的辐照度短时错位，旧口径（逐串各自最近 8 点 +
 * 全库均值做偏差基准）会把离散率与偏差推得乱跳。同窗复核口径：
 *  1. 每个汇流箱取最近 {@link PEER_WINDOW_SIZE} 条采集点作为同一时间窗；
 *  2. 只保留辐照度落在箱内辐照度中位数 ±{@link IRRADIANCE_BAND_RATIO} 带宽内的点；
 *  3. 归一化算法沿用 {@link normalizeCurrent}，各串取窗内归一化电流的中位数代表本串；
 *  4. 离散率与偏差的基准一律取同窗各串代表值的中位数（不用算术均值），
 *     避免离群串把基准拉偏、反而把正常串推成失配；
 *  5. 窗内有效串数不足 {@link PEER_MIN_STRINGS} 串时不启用复核，保留原判定并说明原因。
 */
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from '../types/settings';
import type { DiscreteLevel, Sample, StringDiscreteStat } from '../types/sample';
import { round } from './format';

/** 同窗复核：每个汇流箱取最近采集条数 */
export const PEER_WINDOW_SIZE = 8;
/** 同窗复核：窗内有效串数下限 */
export const PEER_MIN_STRINGS = 3;
/** 同窗复核：辐照度带宽（箱内中位数上下浮动比例） */
export const IRRADIANCE_BAND_RATIO = 0.15;

/** 均值 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 中位数：偶数个时取中间两数均值（抗离群） */
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

/** 以中位数为基准的样本标准差（n-1）：基准不随离群串漂移 */
export function robustStdDev(values: number[], center: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 离散率（%）= 标准差 / 均值 × 100（旧口径，供复核未启用时保留原判定） */
export function discreteRate(values: number[]): number {
  const avg = mean(values);
  if (avg <= 0) return 0;
  return round((stdDev(values) / avg) * 100, 2);
}

/**
 * 同窗离散率（%）= 标准差 / 中位数 × 100。
 * 分母取中位数，离群串既抬高标准差也拉不歪基准。
 */
export function robustDiscreteRate(values: number[]): number {
  if (values.length < 2) return 0;
  const center = median(values);
  if (center <= 0) return 0;
  return round((robustStdDev(values, center) / center) * 100, 2);
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

/** 电流偏差百分比：相对基准值的偏离 */
export function currentBiasPercent(value: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return round(((value - baseline) / baseline) * 100, 2);
}

/** 按时间序列计算某组串的离散率（逐点滚动均值法，取最后一个窗口作为当前离散率） */
export function rollingDiscreteRate(samples: Sample[], windowSize = 5): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  const window = sorted.slice(-Math.max(2, windowSize));
  return discreteRate(window.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2)));
}

/** 分组键：同一逆变器 + 同一汇流箱视为一个可比对集合 */
export function groupKeyOf(row: { inverterId: string; combinerBox: string }): string {
  return `${row.inverterId}::${row.combinerBox}`;
}

/** 组串归属信息（与 types/string 的 StringRow 结构兼容） */
export interface StringOwner {
  id: string;
  inverterId: string;
  combinerBox: string;
}

/** 同窗内某一串的复核中间结果 */
export interface BoxPeerResult {
  stringId: string;
  /** 窗内命中辐照带宽的归一化电流（中位数由调用方再取） */
  normalized: number[];
  /** 窗内命中辐照带宽的原始电流（A） */
  raws: number[];
  /** 命中采集点数 */
  pointCount: number;
  /** 本串窗内归一化电流中位数（代表值，A） */
  representative: number;
  /** 窗内原始电流均值（A，仅展示用） */
  avgCurrentA: number;
  /** 相对箱内中位数基准的电流偏差（%），未复核时为 0 */
  biasPercent: number;
  /** 本串窗内最后采集时间 */
  lastSampledAt: string;
}

/** 单个汇流箱的同窗复核结果 */
export interface BoxReviewResult {
  /** 汇流箱分组键 */
  key: string;
  /** 是否启用同窗复核（false 表示沿用原判定） */
  reviewed: boolean;
  /** 复核口径说明 / 保留原判定的原因 */
  reason: string;
  /** 箱级离散率（%），同窗内各串一致；未复核时为 0 */
  rate: number;
  /** 窗内有效串数 */
  peerCount: number;
  /** 窗内命中辐照带宽的采集点总数 */
  windowPointCount: number;
  /** 截取的窗大小（最近 N 条） */
  windowSize: number;
  /** 窗内全部采集点数（截取后） */
  candidateCount: number;
  /** 窗内辐照度中位数（W/m²） */
  medianIrradiance: number;
  /** 辐照带宽下限（W/m²） */
  irradianceLower: number;
  /** 辐照带宽上限（W/m²） */
  irradianceUpper: number;
  /** 各串结果（仅包含窗内有命中点的串） */
  peers: BoxPeerResult[];
  /** stringId → 同串结果，便于查表 */
  perString: Map<string, BoxPeerResult>;
}

/**
 * 对单个汇流箱执行同窗复核。
 * @param key     汇流箱分组键（仅回填用）
 * @param samples 该箱下全部组串的全部采集点
 */
export function reviewBoxSamples(
  key: string,
  samples: Sample[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
  windowSize: number = PEER_WINDOW_SIZE,
): BoxReviewResult {
  const sorted = [...samples].sort((a, b) => {
    const byTime = b.sampledAt.localeCompare(a.sampledAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const window = sorted.slice(0, Math.max(1, windowSize));
  const candidateCount = window.length;

  const medianIrradiance = median(window.map((item) => item.irradianceWm2));
  // 中位数为 0（整窗无辐照读数）时无法按比例筛带，退化为整窗保留
  const irradianceLower = medianIrradiance > 0 ? medianIrradiance * (1 - IRRADIANCE_BAND_RATIO) : 0;
  const irradianceUpper =
    medianIrradiance > 0 ? medianIrradiance * (1 + IRRADIANCE_BAND_RATIO) : Number.POSITIVE_INFINITY;

  const inBand = (item: Sample): boolean =>
    item.irradianceWm2 >= irradianceLower && item.irradianceWm2 <= irradianceUpper;
  const points = window.filter(inBand);

  const grouped = new Map<string, Sample[]>();
  for (const item of points) {
    const list = grouped.get(item.stringId);
    if (list) list.push(item);
    else grouped.set(item.stringId, [item]);
  }

  const peers: BoxPeerResult[] = [];
  for (const [stringId, list] of grouped) {
    const ordered = [...list].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    const normalized = ordered.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2, config));
    const raws = ordered.map((item) => item.currentA);
    peers.push({
      stringId,
      normalized,
      raws,
      pointCount: ordered.length,
      representative: round(median(normalized), 3),
      avgCurrentA: round(mean(raws), 2),
      biasPercent: 0,
      lastSampledAt: ordered[ordered.length - 1]?.sampledAt ?? '',
    });
  }
  // 稳定顺序：代表值低的（更可疑）排前，便于排查
  peers.sort((a, b) =>
    a.representative !== b.representative
      ? a.representative - b.representative
      : a.stringId.localeCompare(b.stringId),
  );

  const peerCount = peers.length;
  const reviewed = peerCount >= PEER_MIN_STRINGS;
  const windowPointCount = points.length;

  let rate = 0;
  let reason: string;
  if (reviewed) {
    const baseline = median(peers.map((peer) => peer.representative));
    rate = robustDiscreteRate(peers.map((peer) => peer.representative));
    for (const peer of peers) {
      peer.biasPercent = currentBiasPercent(peer.representative, baseline);
    }
    reason = `同窗复核：箱内最近 ${candidateCount} 点中 ${windowPointCount} 点落在辐照中位数 ${round(
      medianIrradiance,
      0,
    )} W/m² ±${IRRADIANCE_BAND_RATIO * 100}% 带宽，${peerCount} 串同窗，基准取各串归一化电流中位数`;
  } else {
    reason = `同窗复核未启用：辐照中位数 ${round(medianIrradiance, 0)} W/m² ±${
      IRRADIANCE_BAND_RATIO * 100
    }% 带宽内仅有 ${peerCount} 串（需 ≥${PEER_MIN_STRINGS} 串），云影下口径不可靠，保留原判定`;
  }

  return {
    key,
    reviewed,
    reason,
    rate,
    peerCount,
    windowPointCount,
    windowSize: Math.max(1, windowSize),
    candidateCount,
    medianIrradiance: round(medianIrradiance, 0),
    irradianceLower: round(irradianceLower, 0),
    irradianceUpper: Number.isFinite(irradianceUpper) ? round(irradianceUpper, 0) : 0,
    peers,
    perString: new Map(peers.map((peer) => [peer.stringId, peer])),
  };
}

/**
 * 由采集记录聚合出组串离散率榜。
 * 先按汇流箱做同窗复核（最近 8 点、辐照中位数 ±15%、中位数基准）；
 * 窗内不足 3 串的箱子保留原口径：逐串最近 8 点时序离散率 + 全库均值偏差。
 */
export function buildStringStats(
  samples: Sample[],
  owners: StringOwner[] = [],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): StringDiscreteStat[] {
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));

  const grouped = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.stringId);
    if (list) list.push(sample);
    else grouped.set(sample.stringId, [sample]);
  }

  interface Draft {
    stringId: string;
    /** 旧口径窗口：本串最近 8 点 */
    legacyValues: number[];
    legacyRaw: number[];
    lastSampledAt: string;
    count: number;
  }

  const drafts = new Map<string, Draft>();
  for (const [stringId, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    const window = sorted.slice(-PEER_WINDOW_SIZE);
    drafts.set(stringId, {
      stringId,
      legacyValues: window.map((item) => normalizeCurrent(item.currentA, item.irradianceWm2, config)),
      legacyRaw: window.map((item) => item.currentA),
      lastSampledAt: sorted[sorted.length - 1]?.sampledAt ?? '',
      count: list.length,
    });
  }

  // 按汇流箱归集串与采集点，逐箱同窗复核
  const boxes = new Map<string, { owner: StringOwner; stringIds: Set<string>; samples: Sample[] }>();
  const orphanIds: string[] = [];
  for (const stringId of drafts.keys()) {
    const owner = ownerMap.get(stringId);
    if (!owner) {
      orphanIds.push(stringId);
      continue;
    }
    const key = groupKeyOf(owner);
    const bucket = boxes.get(key);
    if (bucket) {
      bucket.stringIds.add(stringId);
    } else {
      boxes.set(key, { owner, stringIds: new Set([stringId]), samples: [] });
    }
  }
  for (const sample of samples) {
    const owner = ownerMap.get(sample.stringId);
    if (!owner) continue;
    boxes.get(groupKeyOf(owner))?.samples.push(sample);
  }

  const reviews = new Map<string, BoxReviewResult>();
  for (const [key, bucket] of boxes) {
    reviews.set(key, reviewBoxSamples(key, bucket.samples, config));
  }

  // 先落复核成功的串；其余进入旧口径列表，统一按原算法补偏差与档位
  const stats: StringDiscreteStat[] = [];
  const legacyStats: StringDiscreteStat[] = [];

  const baseStat = (draft: Draft): StringDiscreteStat => ({
    stringId: draft.stringId,
    stringCode: '',
    combinerBox: '',
    inverterId: '',
    arrayId: '',
    plantId: '',
    sampleCount: draft.count,
    avgCurrentA: round(mean(draft.legacyRaw), 2),
    avgNormalizedCurrentA: round(mean(draft.legacyValues), 3),
    discreteRate: discreteRate(draft.legacyValues),
    currentBiasPercent: 0,
    level: 'normal',
    lastSampledAt: draft.lastSampledAt,
    reviewed: false,
    reviewReason: '',
    peerStringCount: 0,
    windowPointCount: 0,
    windowIrradianceMedian: 0,
    windowIrradianceLower: 0,
    windowIrradianceUpper: 0,
  });

  for (const [stringId, draft] of drafts) {
    const owner = ownerMap.get(stringId);
    const stat = baseStat(draft);
    if (!owner) {
      stat.reviewReason = '组串设备台账缺失，无法归入汇流箱同窗，保留原判定';
      legacyStats.push(stat);
      continue;
    }
    const review = reviews.get(groupKeyOf(owner));
    const peer = review?.perString.get(stringId);
    if (review?.reviewed && peer) {
      stat.reviewed = true;
      stat.reviewReason = review.reason;
      stat.discreteRate = review.rate;
      stat.currentBiasPercent = peer.biasPercent;
      stat.avgNormalizedCurrentA = peer.representative;
      stat.avgCurrentA = peer.avgCurrentA;
      stat.peerStringCount = review.peerCount;
      stat.windowPointCount = peer.pointCount;
      stat.windowIrradianceMedian = review.medianIrradiance;
      stat.windowIrradianceLower = review.irradianceLower;
      stat.windowIrradianceUpper = review.irradianceUpper;
      const byRate = levelOf(review.rate, config);
      const byBias: DiscreteLevel =
        Math.abs(peer.biasPercent) >= config.currentBiasPercent ? 'mismatch' : 'normal';
      stat.level =
        byRate === 'mismatch' || byBias === 'mismatch'
          ? 'mismatch'
          : byRate === 'watch'
            ? 'watch'
            : 'normal';
      stats.push(stat);
    } else if (review?.reviewed && !peer) {
      // 箱内同窗复核成功，但本串窗内没有任何点落在辐照带宽内：本串不参与复核，保留原判定
      stat.reviewed = false;
      stat.reviewReason = `同窗复核已在箱内启用，但本串最近窗内无采集点落在辐照中位数 ${review.medianIrradiance} W/m² ±${
        IRRADIANCE_BAND_RATIO * 100
      }% 带宽内，本串保留原判定`;
      stat.peerStringCount = review.peerCount;
      stat.windowPointCount = 0;
      stat.windowIrradianceMedian = review.medianIrradiance;
      stat.windowIrradianceLower = review.irradianceLower;
      stat.windowIrradianceUpper = review.irradianceUpper;
      legacyStats.push(stat);
    } else {
      // 同窗有效串不足 3 串：保留原判定，并把原因带到榜单 / 徽标 / 处置单初始值
      stat.reviewed = false;
      stat.reviewReason = review?.reason ?? '同窗复核未启用，保留原判定';
      stat.peerStringCount = review?.peerCount ?? 0;
      stat.windowPointCount = peer?.pointCount ?? 0;
      stat.windowIrradianceMedian = review?.medianIrradiance ?? 0;
      stat.windowIrradianceLower = review?.irradianceLower ?? 0;
      stat.windowIrradianceUpper = review?.irradianceUpper ?? 0;
      legacyStats.push(stat);
    }
  }

  // 旧口径：偏差基准沿用全库归一化电流均值，档位逻辑与复核上线前保持一致
  const globalBaseline = mean(
    [...stats, ...legacyStats].map((item) => item.avgNormalizedCurrentA),
  );
  for (const stat of legacyStats) {
    const baseline = globalBaseline > 0 ? globalBaseline : stat.avgNormalizedCurrentA;
    stat.currentBiasPercent = currentBiasPercent(stat.avgNormalizedCurrentA, baseline);
    const tooFew = stat.sampleCount < config.minSampleCount;
    const badByRate = levelOf(stat.discreteRate, config);
    const badByBias =
      Math.abs(stat.currentBiasPercent) >= config.currentBiasPercent ? 'mismatch' : 'normal';
    stat.level =
      badByRate === 'mismatch' || badByBias === 'mismatch'
        ? 'mismatch'
        : badByRate === 'watch'
          ? 'watch'
          : tooFew
            ? 'watch'
            : 'normal';
  }

  return [...stats, ...legacyStats];
}

/** 在当前集合内重新计算偏差（旧口径工具，供 UI 对指定汇流箱分组时调用） */
export function rebaseBias(
  stats: StringDiscreteStat[],
  config: ThresholdConfig = DEFAULT_THRESHOLDS,
): StringDiscreteStat[] {
  if (stats.length === 0) return [];
  const baseline = mean(stats.map((item) => item.avgNormalizedCurrentA));
  return stats.map((stat) => {
    const bias = currentBiasPercent(stat.avgNormalizedCurrentA, baseline);
    const byBias = Math.abs(bias) >= config.currentBiasPercent;
    const level: DiscreteLevel = byBias
      ? 'mismatch'
      : stat.level === 'mismatch'
        ? 'mismatch'
        : levelOf(stat.discreteRate, config);
    return { ...stat, currentBiasPercent: bias, level };
  });
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
