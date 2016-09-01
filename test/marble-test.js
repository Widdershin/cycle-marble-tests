/* globals describe, it */
import Cycle from '@cycle/xstream-run';
import delay from 'xstream/extra/delay';
import assert from 'assert';
import _ from 'lodash';
import now from 'performance-now';
import xs from 'xstream';
import requestAnimationFrame from 'raf';

const DEBUG = false;

function Time ({timeUnit = 20} = {}) {
  const schedule = [];
  let time = 0;

  return {
    fromDiagram (diagram) {
      const stream = xs.create();

      const events = diagram.split('').map((character, index) => {
        if (character === '-') {
          return null;
        }

        const eventTime = index * timeUnit;

        if (character === '|') {
          return {type: 'complete', time: eventTime, stream};
        }

        return {type: 'next', time: eventTime, event: character, stream};
      });

      events.forEach(event => event && schedule.push(event));

      stream.diagram = events;
      stream.diagram.toString = () => diagram;

      return stream;
    },

    compare (actual, expected, done) {
      const expectedDiagram = expected.diagram;

      const actualDiagram = [];

      actual.addListener({
        next (event) {
          actualDiagram.push({type: 'next', event, time});
        },
        complete () {
          actualDiagram.push({type: 'complete', time});

          assert.equal(toDiagram(actualDiagram), expectedDiagram.toString());

          done();
        },
        error (err) {
          done(err);
        }
      });
    },

    run () {
      schedule
        .sort((a, b) => a.time - b.time)
        .forEach((event) => {
          if (event.time) {
            time = event.time;
          }

          if (event.type === 'complete') {
            event.stream.shamefullySendComplete();
          } else if (event.type === 'next') {
            event.stream.shamefullySendNext(event.event);
          } else {
            throw new Error(`wtf is ${event.type}`);
          }
        });
    },

    delay (delayAmount) {
      let out;
      let ins;

      return (stream) => {
        return new xs({
          type: 'scheduledDelay',

          ins: stream,

          _start (outStream) {
            out = outStream;

            stream._add(this);
          },

          _stop () {
            out = null;

            stream._remove(this);
          },

          _n (event) {
            schedule.push({stream: out, event, time: time + delayAmount})
              console.log(time, event);
          },

          _e (err) {
          },

          _c () {
          }
        });
      }
    }
  };
}

function timeDriver (sinks, streamAdaptor) {
  const {observer, stream} = streamAdaptor.makeSubject();

  let previousTime = now();
  let frameHandle;

  function tick (timestamp) {
    observer.next({
      timestamp,
      delta: timestamp - previousTime
    });

    previousTime = timestamp;

    frameHandle = requestAnimationFrame(tick);
  }

  stream.dispose = () => {
    requestAnimationFrame.cancel(frameHandle);
  };

  tick(previousTime);

  return stream;
}

const toDiagram = (valuesInOrder) => {
  const valuesByTime = _.groupBy(valuesInOrder, value => Math.floor(value.time / 20));

  const maxTime = Math.floor((Math.max(...valuesInOrder.map(value => value.time))) / 20) + 1

  return _.range(maxTime).map(pointInTime => {
    const values = valuesByTime[pointInTime];

    if (!values || values.length === 0) {
      return '-';
    }

    if (values.length === 1) {
      if (values[0].type === 'complete') {
        return '|';
      }

      return values[0].event.toString();
    }

    return `(${values.map(value => value.event).join('')})`;
  }).join('');
};

describe('marble testing', () => {
  it('allows testing streams', (done) => {
    const time = Time();
    const fromDiagram = time.fromDiagram;

    const stream1  = fromDiagram('-a----c-----|');
    const stream2  = fromDiagram('---b-----d--|');
    const expected = fromDiagram('-a-b--c--d--|');

    time.compare(xs.merge(stream1, stream2), expected, done);

    time.run();
  });

  it('can test time based operators (delay)', (done) => {
    const time = Time();
    const fromDiagram = time.fromDiagram;

    const stream   = fromDiagram('-a----b-----|');
    const expected = fromDiagram('---a----b---|');

    time.compare(stream.compose(time.delay(40)), expected, done);

    time.run();
  });

  xit('can test Cycle apps', (done) => {
    function main ({click$}) {
      return {
        HTTP: click$.compose(delay(100))
      };
    }

    const click$          = fromDiagram('---a---b-------|');
    const expectedHTTP$   = fromDiagram('--------a---b--|');

    const drivers = {
      click$: () => click$,
      HTTP: (sinks) => null,
      Time: timeDriver
    };

    const {sources, sinks, run} = Cycle(main, drivers);

    expectEqual(sinks.HTTP, expectedHTTP$, done);

    run();
  });
});

