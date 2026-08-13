import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BEAD_CATALOG, findBeadType } from '../../palette/beadSpecs.js';

test('findBeadType returns the matching entry', () => {
  const catalog = [
    { id: 'delica11', name: 'Delica 11/0' },
    { id: 'rocaille11', name: 'Round Rocaille 11/0' },
  ];
  assert.equal(findBeadType(catalog, 'rocaille11'), catalog[1]);
});

test('findBeadType returns null when nothing matches', () => {
  const catalog = [{ id: 'delica11', name: 'Delica 11/0' }];
  assert.equal(findBeadType(catalog, 'nonexistent'), null);
});

test('DEFAULT_BEAD_CATALOG seeds the two original bead types with their prior hardcoded values', () => {
  const delica = DEFAULT_BEAD_CATALOG.find((b) => b.id === 'delica11');
  const rocaille = DEFAULT_BEAD_CATALOG.find((b) => b.id === 'rocaille11');
  assert.equal(delica.widthMm, 1.6);
  assert.equal(delica.heightMm, 1.3);
  assert.equal(delica.cornerRadiusFraction, null);
  assert.equal(rocaille.widthMm, 2.0);
  assert.equal(rocaille.heightMm, 1.4);
  assert.equal(rocaille.cornerRadiusFraction, 0.25);
});
