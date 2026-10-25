import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PreRouteCache } from '../dist/index.js';

describe('PreRouteCache constructor validation (BUG-01, BUG-02)', () => {
  it('enforces positive integer maxSize at construction time (BUG-02)', () => {
    assert.throws(
      () => new PreRouteCache({ maxSize: 0 }),
      /maxSize must be a positive integer/
    );
    assert.throws(
      () => new PreRouteCache({ maxSize: -5 }),
      /maxSize must be a positive integer/
    );
    assert.throws(
      () => new PreRouteCache({ maxSize: 1.5 }),
      /maxSize must be a positive integer/
    );
  });

  it('validates ttlMs and namespace format at construction time (BUG-01)', () => {
    assert.throws(
      () => new PreRouteCache({ ttlMs: 0 }),
      /Invalid ttlMs value/
    );
    assert.throws(
      () => new PreRouteCache({ ttlMs: -100 }),
      /Invalid ttlMs value/
    );
    assert.throws(
      () => new PreRouteCache({ namespace: 'bad/namespace!' }),
      /Invalid namespace format/
    );

    const valid = new PreRouteCache({ maxSize: 64, ttlMs: 5000, namespace: 'prod_v1-a' });
    assert.equal(valid.namespace, 'prod_v1-a');
  });

  it('encapsulates validatePreRouterOptions as an internal helper while enforcing createPreRouter validation (BUG-01)', async () => {
    const mod = await import('../dist/index.js');
    assert.equal(typeof mod.validatePreRouterOptions, 'undefined');
    assert.throws(
      () => mod.createPreRouter({ preset: 'invalid-preset' }),
      /Invalid PreRouterOptions: preset must be one of/
    );
    assert.throws(
      () => mod.createPreRouter({ cachePolicy: 'invalid-policy' }),
      /Invalid PreRouterOptions: cachePolicy must be one of/
    );
  });

  it('validates preset, rulesVersion, and cachePolicy directly in PreRouteCache constructor (BUG-01, BUG-02, BUG-03)', () => {
    assert.throws(
      () => new PreRouteCache({ preset: 'invalid-preset' }),
      /Invalid preset value/
    );
    assert.throws(
      () => new PreRouteCache({ rulesVersion: -1 }),
      /Invalid rulesVersion value/
    );
    assert.throws(
      () => new PreRouteCache({ rulesVersion: 2.5 }),
      /Invalid rulesVersion value/
    );
    assert.throws(
      () => new PreRouteCache({ cachePolicy: 'invalid-policy' }),
      /Invalid cachePolicy value/
    );

    const valid = new PreRouteCache({
      preset: 'structure+lexical',
      rulesVersion: 0,
      cachePolicy: 'all'
    });
    assert.equal(valid.preset, 'structure+lexical');
    assert.equal(valid.rulesVersion, 0);
    assert.equal(valid.cachePolicy, 'all');
  });

  it('propagates exceptions thrown inside user-supplied onError callback (Pass #6 BUG-01)', async () => {
    const { createPreRouter } = await import('../dist/index.js');
    const router = createPreRouter({
      onRoute() {
        throw new Error('simulated telemetry failure');
      },
      onError() {
        throw new Error('onError handler fatal failure');
      }
    });

    assert.throws(
      () => router.classify('```js\nconst a = 1;\n```'),
      /onError handler fatal failure/
    );
  });
});


