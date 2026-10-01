import { describe, expect, test } from 'bun:test';

import { authFor, parseNpmrcAuth } from './index';

describe('parseNpmrcAuth', () => {
  test('token, _auth and username/_password, scoped by registry prefix', () => {
    const auths = parseNpmrcAuth(
      [
        '@acme:registry=https://npm.example/repo/',
        '//npm.example/repo/:_auth=dXNlcjpwYXNz',
        '//other.example/:_authToken=${TOKEN}',
        '//third.example/npm:username=me',
        `//third.example/npm:_password=${Buffer.from('secret').toString('base64')}`,
        '# //commented.example/:_authToken=x',
        '_authToken=unscoped',
      ].join('\n'),
      { TOKEN: 'abc' },
    );
    expect(auths).toEqual([
      { prefix: '//npm.example/repo/', header: 'Basic dXNlcjpwYXNz' },
      { prefix: '//other.example/', header: 'Bearer abc' },
      {
        prefix: '//third.example/npm/',
        header: `Basic ${Buffer.from('me:secret').toString('base64')}`,
      },
    ]);
  });
});

describe('authFor', () => {
  const auths = [
    { prefix: '//npm.example/', header: 'Bearer outer' },
    { prefix: '//npm.example/repo/', header: 'Bearer inner' },
  ];

  test('the longest matching prefix wins; other hosts get none', () => {
    expect(authFor('https://npm.example/repo/a/-/a-1.0.0.tgz', auths)?.header).toBe('Bearer inner');
    expect(authFor('https://npm.example/b/-/b-1.0.0.tgz', auths)?.header).toBe('Bearer outer');
    expect(authFor('https://registry.npmjs.org/c/-/c-1.0.0.tgz', auths)).toBeUndefined();
  });
});
