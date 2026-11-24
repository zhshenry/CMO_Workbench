// Places the schedule + todo capsule group in the horizontal center of the
// topbar. The right cluster's real width is reserved on both sides so the
// group does not cover window controls. The group shifts left only when the
// centered band cannot fit both controls and a readable schedule title.
export const TOPBAR_CLUSTER_GAP = 12;

export interface TopbarCapsuleBox {
  barWidth: number;
  padLeft: number;
  /** Distance from the topbar's right border edge to the left edge of .tb-right. */
  rightInset: number;
  /** Unconstrained width of the capsule group, excluding popovers. */
  naturalWidth: number;
  /** Minimum width with the compact summary and both controls visible. */
  readableWidth: number;
  gap?: number;
}

export interface TopbarCapsulePlacement {
  width: number;
  /** Extra leftward shift after translateX(-50%). Zero keeps the true center. */
  nudge: number;
}

export function topbarCapsulePlacement(box: TopbarCapsuleBox): TopbarCapsulePlacement {
  const gap = box.gap ?? TOPBAR_CLUSTER_GAP;
  const side = Math.max(0, box.rightInset) + gap;
  // Negative when the right cluster is wider than half the bar. Keep the sign
  // so the nudge can still park the group against that cluster.
  const centeredSpan = box.barWidth - 2 * side;
  const freeWidth = Math.max(0, box.barWidth - side - Math.max(0, box.padLeft));
  const natural = Math.max(0, box.naturalWidth);
  const readable = Math.min(natural, Math.max(0, box.readableWidth));
  let width = Math.min(natural, Math.max(centeredSpan, readable));
  if (width <= 0 && natural > 0) width = Math.min(natural, freeWidth);
  width = Math.min(Math.max(width, 0), freeWidth);
  const nudge = width > centeredSpan ? (width - centeredSpan) / 2 : 0;
  return { width, nudge };
}

export function applyTopbarCapsulePlacement(bar: HTMLElement): void {
  const middle = bar.querySelector<HTMLElement>('.tb-middle');
  const right = bar.querySelector<HTMLElement>('.tb-right');
  if (!middle || !right) return;
  const barRect = bar.getBoundingClientRect();
  if (barRect.width < 1) return;

  const previousMax = middle.style.maxWidth;
  middle.style.maxWidth = 'none';
  const natural = middle.getBoundingClientRect().width;
  if (natural < 1) {
    middle.style.maxWidth = previousMax;
    return;
  }

  // Measure both equal columns with a readable title width and no time.
  middle.dataset.measureCompactSummary = '';
  const readable = middle.getBoundingClientRect().width;
  delete middle.dataset.measureCompactSummary;

  const brand = bar.querySelector<HTMLElement>('.tb-brand')?.getBoundingClientRect();
  const padLeft = Math.max(Number.parseFloat(getComputedStyle(bar).paddingLeft) || 0,
    brand && brand.width > 0 ? brand.right - barRect.left + TOPBAR_CLUSTER_GAP : 0);
  const placement = topbarCapsulePlacement({
    barWidth: barRect.width,
    padLeft,
    rightInset: barRect.right - right.getBoundingClientRect().left,
    naturalWidth: natural,
    readableWidth: readable,
  });
  const track = middle.querySelector<HTMLElement>('.sched-track');
  // display:none while the window is ≤1180. An inline pixel cap from that
  // measurement stays in force for the first frame after the track returns,
  // and a flex item with a 0 floor collapses to an empty box.
  const trackShown = !track || getComputedStyle(track).display !== 'none';
  middle.style.setProperty('--tb-middle-cap', `${placement.width}px`);
  middle.style.maxWidth = trackShown ? `${placement.width}px` : '';
  middle.style.transform = placement.nudge > 0.5 ? `translateX(calc(-50% - ${placement.nudge}px))` : '';
}
