import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderForInsertAt } from '../../state/designOrder.js';

test('orderForInsertAt: empty list returns 0', () => {
  assert.equal(orderForInsertAt([], 0), 0);
});

test('orderForInsertAt: insert at start sorts before the current first item', () => {
  const list = [{ order: 5 }, { order: 10 }];
  const order = orderForInsertAt(list, 0);
  assert.ok(order < list[0].order);
});

test('orderForInsertAt: insert at end sorts after the current last item', () => {
  const list = [{ order: 5 }, { order: 10 }];
  const order = orderForInsertAt(list, list.length);
  assert.ok(order > list[list.length - 1].order);
});

test('orderForInsertAt: insert in the middle sorts between its new neighbors', () => {
  const list = [{ order: 5 }, { order: 10 }, { order: 20 }];
  const order = orderForInsertAt(list, 1);
  assert.ok(order > list[0].order && order < list[1].order);
});

test('orderForInsertAt: insert in a single-item list at index 0 sorts before it', () => {
  const list = [{ order: 5 }];
  const order = orderForInsertAt(list, 0);
  assert.ok(order < list[0].order);
});
