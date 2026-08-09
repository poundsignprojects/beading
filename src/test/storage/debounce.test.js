import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../../storage/debounce.js';

test('debounce: rapid calls collapse into one invocation with the last call\'s args', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const debounced = debounce((...args) => calls.push(args), 800);

  debounced('a');
  debounced('b');
  debounced('c');
  assert.equal(calls.length, 0);

  t.mock.timers.tick(800);
  assert.deepEqual(calls, [['c']]);
});

test('debounce: flush() invokes immediately and cancels the pending timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const debounced = debounce((...args) => calls.push(args), 800);

  debounced('x');
  debounced.flush();
  assert.deepEqual(calls, [['x']]);

  t.mock.timers.tick(800);
  assert.deepEqual(calls, [['x']]); // no second call from the cancelled timer
});

test('debounce: flush() with nothing pending is a no-op', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const debounced = debounce((...args) => calls.push(args), 800);

  debounced.flush();
  assert.equal(calls.length, 0);
});
