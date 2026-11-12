import assert from 'node:assert/strict';
import test from 'node:test';
import { formatQuota, quotaModelShares } from '../shared/island-quota';

test('token values below one thousand retain their original unit', () => {
  for (const value of [0, 1, 500, 999]) assert.equal(formatQuota(value), String(value));
});

test('token values use K and M only after the corresponding thresholds', () => {
  for (const [value, expected] of [[1000, '1.0K'], [1500, '1.5K'], [1_000_000, '1.0M'], [1_500_000, '1.5M']] as const) {
    assert.equal(formatQuota(value), expected);
  }
});

test('compact token readouts retain two significant decimal places', () => {
  assert.equal(formatQuota(1_280_000), '1.28M');
  assert.equal(formatQuota(12_340), '12.34K');
});

test('model shares use the daily total rather than the largest model', () => {
  const parts = quotaModelShares(1_280_000, [
    { name: 'Claude Sonnet', quota: 768_000 },
    { name: 'GPT', quota: 320_000 },
    { name: 'DeepSeek', quota: 192_000 },
  ]);
  assert.deepEqual(parts.map(part => part.share), [60, 25, 15]);
  assert.equal(parts.reduce((sum, part) => sum + part.quota, 0), 1_280_000);
});

test('incomplete model logs leave an explicit unattributed share', () => {
  const parts = quotaModelShares(1_000, [{ name: 'GPT', quota: 600 }]);
  assert.deepEqual(parts.map(({ name, quota, share }) => ({ name, quota, share })), [
    { name: 'GPT', quota: 600, share: 60 },
    { name: '未分项', quota: 400, share: 40 },
  ]);
  assert.equal(parts[1].unattributed, true);
});

test('zero usage, absent model detail and inconsistent snapshots do not invent a composition', () => {
  assert.deepEqual(quotaModelShares(0, []), []);
  assert.deepEqual(quotaModelShares(500, []), []);
  assert.deepEqual(quotaModelShares(500, [{ name: 'GPT', quota: 600 }]), []);
  assert.deepEqual(quotaModelShares(500, [{ name: 'GPT', quota: 0 }]), []);
});
