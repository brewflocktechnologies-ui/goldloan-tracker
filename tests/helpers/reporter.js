'use strict';
/**
 * Test reporter: same output as Node's default "spec" reporter, except that failures of
 * tests marked `todo` (known bugs, see tests/known-bugs.test.js) are shown as one quiet line
 * labelled KNOWN BUG, not a full error block. Real failures are still printed in full.
 * (Don't rename tests here: the spec reporter tracks them by name from start to finish.)
 */
const { Readable } = require('node:stream');
const { spec: Spec } = require('node:test/reporters');

async function* quietTodoFailures(source) {
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data.todo) {
      const { error, ...details } = event.data.details || {};
      yield { type: 'test:pass', data: { ...event.data, todo: 'KNOWN BUG: ' + (typeof event.data.todo === 'string' ? event.data.todo : 'not fixed yet'), details } };
    } else {
      yield event;
    }
  }
}

module.exports = async function* (source) {
  yield* Readable.from(quietTodoFailures(source)).compose(new Spec());
};
