import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPatternsUsingBeadType } from '../../palette/beadTypeUsage.js';

function design(id, name, beadTypeKey) {
  return { id, name, beadTypeKey };
}

test('a bead type referenced by one design returns one result', () => {
  const designs = [design('d1', 'Design One', 'delica11')];
  assert.deepEqual(findPatternsUsingBeadType(designs, 'delica11'), [
    { designId: 'd1', designName: 'Design One' },
  ]);
});

test('a bead type referenced by multiple designs returns one result per design', () => {
  const designs = [
    design('d1', 'Design One', 'delica11'),
    design('d2', 'Design Two', 'delica11'),
    design('d3', 'Design Three', 'rocaille11'),
  ];
  assert.deepEqual(findPatternsUsingBeadType(designs, 'delica11'), [
    { designId: 'd1', designName: 'Design One' },
    { designId: 'd2', designName: 'Design Two' },
  ]);
});

test('a bead type referenced by no design returns an empty array', () => {
  const designs = [design('d1', 'Design One', 'rocaille11')];
  assert.deepEqual(findPatternsUsingBeadType(designs, 'delica11'), []);
});
